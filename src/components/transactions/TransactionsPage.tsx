import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Upload, Plus, Search, Send, CheckCircle, X, Landmark } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useCategorizationSessions } from '../../hooks/useCategorizationSession';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { TransactionTable } from './TransactionTable';
import { TransactionForm } from './TransactionForm';
import { ImportModal } from './ImportModal';
import { PluggySync } from './PluggySync';
import { ShareCategorizationModal } from './ShareCategorizationModal';
import { getMonthYear, getMonthLabel } from '../../lib/utils';
import type { Transaction } from '../../types';

export function TransactionsPage() {
  const { transactions, loading, addTransaction, updateTransaction, deleteTransaction, importBatch, batchUpdateReconciled } = useTransactions();
  const { categories, rules, matchCategory, addRule, updateRule } = useCategories();
  const { accounts, accountNames } = useAccounts();
  const { titularNames } = useTitularMappings();
  const { memberNames: familyMemberNames } = useFamilyMembers();
  const { sessions, applyCategorizationsFromSession, applyAllPendingSessions, dismissSession } = useCategorizationSessions();
  const { getClosedCycle, reopenCycle } = useBillingCycles();
  const { activeProjects } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPluggySync, setShowPluggySync] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const hasPluggyCredentials = !!(localStorage.getItem('pluggy_client_id') && localStorage.getItem('pluggy_client_secret'));
  const [filterMonth, setFilterMonth] = useState(getMonthYear());
  const [filterTitular, setFilterTitular] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterInstallment, setFilterInstallment] = useState('all');
  const [filterReconciled, setFilterReconciled] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [applyingSession, setApplyingSession] = useState<string | null>(null);
  const autoApplied = useRef(false);

  // Auto-apply ALL pending categorizations when page loads and sessions are available
  // This doesn't depend on categorizedCount — it reads the actual session transactions
  useEffect(() => {
    if (autoApplied.current || sessions.length === 0) return;
    autoApplied.current = true;
    applyAllPendingSessions();
  }, [sessions, applyAllPendingSessions]);

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const allTitulars = useMemo(() => {
    // Prefer the canonical family member names; only add raw titular strings
    // when they don't match any known member (case-insensitive).
    const knownNames = familyMemberNames.length > 0 ? familyMemberNames : titularNames;
    const set = new Set<string>(knownNames);
    for (const t of transactions) {
      // familyMember is already fuzzy-matched to a canonical name at import time.
      // Fall back to titular for older transactions imported before this fix.
      const name = (t.familyMember || t.titular || '').trim();
      if (!name) continue;
      const alreadyCovered = knownNames.some((k) => k.toLowerCase() === name.toLowerCase());
      if (!alreadyCovered) set.add(name);
    }
    return Array.from(set).filter(Boolean).sort();
  }, [transactions, titularNames, familyMemberNames]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterMonth !== 'all') {
      list = list.filter((t) => getMonthYear(t.date) === filterMonth);
    }
    if (filterTitular !== 'all') {
      // Match against both fields: titular (raw) and familyMember (canonical).
      // This ensures transactions from older imports (where titular wasn't normalized)
      // still appear when filtering by the canonical member name.
      list = list.filter((t) => t.titular === filterTitular || t.familyMember === filterTitular);
    }
    if (filterCategory === 'uncategorized') {
      list = list.filter((t) => !t.categoryId);
    } else if (filterCategory !== 'all') {
      list = list.filter((t) => t.categoryId === filterCategory);
    }
    if (filterAccount !== 'all') {
      list = list.filter((t) => t.account === filterAccount);
    }
    if (filterInstallment === 'installments') {
      list = list.filter((t) => t.totalInstallments && t.totalInstallments >= 2);
    } else if (filterInstallment === 'single') {
      list = list.filter((t) => !t.totalInstallments || t.totalInstallments < 2);
    }
    if (filterReconciled === 'pending') {
      list = list.filter((t) => !t.reconciled);
    } else if (filterReconciled === 'reconciled') {
      list = list.filter((t) => t.reconciled);
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.account.toLowerCase().includes(q) ||
          t.familyMember.toLowerCase().includes(q) ||
          (t.titular || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [transactions, filterMonth, filterTitular, filterCategory, filterAccount, filterInstallment, filterReconciled, searchText]);

  /** Check if transaction date falls in a closed billing cycle for a credit card account */
  function checkClosedCycle(item: Omit<Transaction, 'id' | 'createdAt'>): { cycleId: string; label: string } | null {
    const account = accounts.find((a) => a.name === item.account && a.type === 'cartao');
    if (!account) return null;
    const closed = getClosedCycle(account.id, item.date);
    if (!closed) return null;
    return { cycleId: closed.id, label: `${account.name} — ${getMonthLabel(closed.monthYear)}` };
  }

  const handleAddTransaction = useCallback(async (item: Omit<Transaction, 'id' | 'createdAt'>) => {
    const closed = checkClosedCycle(item);
    if (closed) {
      const reopen = window.confirm(
        `A fatura "${closed.label}" está encerrada.\n\nDeseja reabri-la para adicionar esta transação?`
      );
      if (!reopen) return;
      await reopenCycle(closed.cycleId);
    }

    // If installment purchase, create future installment transactions
    if (item.totalInstallments && item.totalInstallments >= 2) {
      const items: Omit<Transaction, 'id' | 'createdAt'>[] = [];
      const purchaseDate = item.purchaseDate || item.date;
      for (let inst = 1; inst <= item.totalInstallments; inst++) {
        const futureDate = new Date(item.date);
        futureDate.setMonth(futureDate.getMonth() + (inst - 1));
        items.push({
          ...item,
          date: futureDate,
          purchaseDate,
          installmentNumber: inst,
          totalInstallments: item.totalInstallments,
          categoryId: item.categoryId || matchCategory(item.description),
        });
      }
      await importBatch(items);
    } else {
      await addTransaction(item);
    }
  }, [accounts, addTransaction, importBatch, matchCategory, getClosedCycle, reopenCycle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = useCallback(async (items: Omit<Transaction, 'id' | 'createdAt'>[]) => {
    // Check for any closed cycles in the batch
    const closedLabels = [...new Set(
      items.map((i) => checkClosedCycle(i)?.label).filter(Boolean) as string[]
    )];
    if (closedLabels.length > 0) {
      const reopen = window.confirm(
        `As seguintes faturas estão encerradas:\n${closedLabels.join('\n')}\n\nDeseja reabri-las para importar?`
      );
      if (!reopen) return;
      for (const item of items) {
        const closed = checkClosedCycle(item);
        if (closed) await reopenCycle(closed.cycleId);
      }
    }

    // 1. Apply rules first
    const categorized = items.map((item) => ({
      ...item,
      categoryId: item.categoryId || matchCategory(item.description),
    }));

    // 2. AI fallback for uncategorized (e.g. PluggySync transactions)
    const uncategorizedDescs = [...new Set(
      categorized.filter((i) => !i.categoryId).map((i) => i.description)
    )];
    const apiKey = localStorage.getItem('anthropic_api_key') || '';
    if (uncategorizedDescs.length > 0 && apiKey && categories.length > 0) {
      try {
        const categoryInfos = categories.map((c) => ({
          id: c.id,
          name: c.name,
          parentName: c.parentId ? categories.find((p) => p.id === c.parentId)?.name || null : null,
          type: c.type,
        }));
        const res = await fetch('/api/suggest-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descriptions: uncategorizedDescs, categories: categoryInfos, apiKey }),
        });
        if (res.ok) {
          const data = await res.json() as {
            suggestions: Record<string, { categoryId: string | null; confidence: number }>;
          };
          for (const item of categorized) {
            if (!item.categoryId) {
              const suggestion = data.suggestions?.[item.description];
              if (suggestion?.categoryId && suggestion.confidence >= 0.7) {
                item.categoryId = suggestion.categoryId;
              }
            }
          }
        }
      } catch {
        // AI categorization failed silently
      }
    }

    await importBatch(categorized);
  }, [accounts, categories, importBatch, matchCategory, getClosedCycle, reopenCycle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateRule = useCallback(async (description: string, categoryId: string) => {
    const existing = rules.find((r) => r.pattern.toLowerCase() === description.toLowerCase());
    if (existing) {
      await updateRule(existing.id, { categoryId });
    } else {
      await addRule({ pattern: description, keywords: [], categoryId });
    }
  }, [rules, addRule, updateRule]);

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando transacoes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Transacoes</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <Plus size={14} /> Nova
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
          >
            <Upload size={14} /> Importar Extrato
          </button>
          {hasPluggyCredentials && (
            <button
              onClick={() => setShowPluggySync(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-accent text-accent text-xs font-bold rounded hover:bg-accent/10"
              title="Sincronizar transacoes automaticamente via Open Banking (Pluggy)"
            >
              <Landmark size={14} /> Sincronizar Banco
            </button>
          )}
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-accent text-accent text-xs font-bold rounded hover:bg-accent/10"
          >
            <Send size={14} /> Enviar p/ Categorizar
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todas as contas</option>
          {accountNames.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>{getMonthLabel(m)}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todas as categorias</option>
          <option value="uncategorized">Sem categoria</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <select
          value={filterTitular}
          onChange={(e) => setFilterTitular(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os titulares</option>
          {allTitulars.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterInstallment}
          onChange={(e) => setFilterInstallment(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os tipos</option>
          <option value="installments">Parcelados</option>
          <option value="single">Avulsos</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text-secondary" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por descricao, conta, membro..."
            className="w-full pl-8 pr-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="flex gap-4 text-xs text-text-secondary flex-wrap">
        <span>{filtered.length} transacoes</span>
        <span className="text-accent-green">
          Receitas: R$ {filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        <span className="text-accent-red">
          Despesas: R$ {Math.abs(filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        {filtered.filter((t) => !t.reconciled).length > 0 && (
          <button
            onClick={() => setFilterReconciled(filterReconciled === 'pending' ? 'all' : 'pending')}
            className={`hover:underline ${filterReconciled === 'pending' ? 'text-accent font-bold' : 'text-accent'}`}
          >
            {filtered.filter((t) => !t.reconciled).length} pendentes conciliacao
            {filterReconciled === 'pending' && ' ✕'}
          </button>
        )}
      </div>

      {(() => {
        const activeSessions = sessions.filter((s) => s.expiresAt > new Date());
        if (activeSessions.length === 0) return null;
        return (
          <div className="space-y-2">
            {activeSessions.length > 1 && (
              <div className="flex justify-end">
                <button
                  onClick={async () => {
                    for (const s of activeSessions) await dismissSession(s.id);
                  }}
                  className="text-[10px] text-text-secondary hover:text-accent-red"
                >
                  Remover todas ({activeSessions.length})
                </button>
              </div>
            )}
            {activeSessions.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-accent/10 border border-accent/30 rounded-lg text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-accent" />
                  <span className="text-text-primary">
                    <strong>{s.titularName}</strong> — {s.categorizedCount}/{s.transactionIds.length} categorizadas
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setApplyingSession(s.id);
                      const count = await applyCategorizationsFromSession(s.id);
                      setApplyingSession(null);
                      if (count > 0) {
                        alert(`${count} categorias aplicadas com sucesso!`);
                      }
                      await dismissSession(s.id);
                    }}
                    disabled={applyingSession === s.id}
                    className="px-3 py-1.5 bg-accent text-bg-primary font-bold rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {applyingSession === s.id ? 'Aplicando...' : 'Aplicar'}
                  </button>
                  <button
                    onClick={() => dismissSession(s.id)}
                    className="p-1 text-text-secondary hover:text-accent-red"
                    title="Remover"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            {activeSessions.length > 3 && (
              <p className="text-[10px] text-text-secondary text-center">
                + {activeSessions.length - 3} sessoes ocultas
              </p>
            )}
          </div>
        );
      })()}

      <TransactionTable
        transactions={filtered}
        categories={categories}
        projects={activeProjects}
        accountNames={accountNames}
        onUpdate={updateTransaction}
        onDelete={deleteTransaction}
        onBatchReconcile={batchUpdateReconciled}
        checkClosedCycle={checkClosedCycle}
        reopenCycle={reopenCycle}
        onCreateRule={handleCreateRule}
        rules={rules}
      />

      {showForm && <TransactionForm onSubmit={handleAddTransaction} onClose={() => setShowForm(false)} titularNames={allTitulars} categories={categories} accountNames={accountNames} accounts={accounts} />}
      {showImport && (
        <ImportModal
          existingTransactions={transactions}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          accountNames={accountNames}
          accounts={accounts}
          categories={categories}
          allTitulars={allTitulars}
          titularNames={familyMemberNames.length > 0 ? familyMemberNames : titularNames}
          matchCategory={matchCategory}
          addRule={addRule}
        />
      )}
      {showPluggySync && (
        <PluggySync
          existingTransactions={transactions}
          accounts={accounts}
          titularNames={familyMemberNames.length > 0 ? familyMemberNames : titularNames}
          onImport={handleImport}
          onClose={() => setShowPluggySync(false)}
        />
      )}
      {showShareModal && (
        <ShareCategorizationModal
          transactions={filtered}
          categories={categories}
          titulars={allTitulars}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
