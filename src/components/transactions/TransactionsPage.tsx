import { useState, useMemo, useCallback } from 'react';
import { Upload, Plus, Search, Send, CheckCircle } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useCategorizationSessions } from '../../hooks/useCategorizationSession';
import { TransactionTable } from './TransactionTable';
import { TransactionForm } from './TransactionForm';
import { ImportModal } from './ImportModal';
import { ShareCategorizationModal } from './ShareCategorizationModal';
import { getMonthYear, getMonthLabel } from '../../lib/utils';
import type { Transaction } from '../../types';

export function TransactionsPage() {
  const { transactions, loading, addTransaction, updateTransaction, deleteTransaction, importBatch } = useTransactions();
  const { categories, matchCategory } = useCategories();
  const { accountNames } = useAccounts();
  const { titularNames } = useTitularMappings();
  const { sessions, applyCategorizationsFromSession } = useCategorizationSessions();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [filterMonth, setFilterMonth] = useState(getMonthYear());
  const [filterTitular, setFilterTitular] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [applyingSession, setApplyingSession] = useState<string | null>(null);

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const allTitulars = useMemo(() => {
    const set = new Set(transactions.map((t) => t.titular).filter(Boolean));
    titularNames.forEach((n) => set.add(n));
    return Array.from(set).sort();
  }, [transactions, titularNames]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterMonth !== 'all') {
      list = list.filter((t) => getMonthYear(t.date) === filterMonth);
    }
    if (filterTitular !== 'all') {
      list = list.filter((t) => t.titular === filterTitular);
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
  }, [transactions, filterMonth, filterTitular, searchText]);

  // Auto-categorize items before importing
  const handleImport = useCallback(async (items: Omit<Transaction, 'id' | 'createdAt'>[]) => {
    const categorized = items.map((item) => ({
      ...item,
      categoryId: item.categoryId || matchCategory(item.description),
    }));
    await importBatch(categorized);
  }, [importBatch, matchCategory]);

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
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-accent text-accent text-xs font-bold rounded hover:bg-accent/10"
          >
            <Send size={14} /> Enviar p/ Categorizar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text-secondary" />
          <input
            tabIndex={1}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por descricao, conta, membro..."
            className="w-full pl-8 pr-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
        </div>
        <select
          tabIndex={2}
          value={filterTitular}
          onChange={(e) => setFilterTitular(e.target.value)}
          className="px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os titulares</option>
          {allTitulars.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          tabIndex={3}
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>{getMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-xs text-text-secondary">
        <span>{filtered.length} transacoes</span>
        <span className="text-accent-green">
          Receitas: R$ {filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        <span className="text-accent-red">
          Despesas: R$ {Math.abs(filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
      </div>

      {/* Pending categorization sessions */}
      {sessions.filter((s) => s.categorizedCount > 0 && s.expiresAt > new Date()).map((s) => (
        <div key={s.id} className="flex items-center justify-between p-3 bg-accent/10 border border-accent/30 rounded-lg text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="text-accent" />
            <span className="text-text-primary">
              <strong>{s.titularName}</strong> categorizou {s.categorizedCount}/{s.transactionIds.length} transacoes
            </span>
          </div>
          <button
            onClick={async () => {
              setApplyingSession(s.id);
              const count = await applyCategorizationsFromSession(s.id);
              setApplyingSession(null);
              alert(`${count} categorias aplicadas!`);
            }}
            disabled={applyingSession === s.id}
            className="px-3 py-1.5 bg-accent text-bg-primary font-bold rounded hover:opacity-90 disabled:opacity-50"
          >
            {applyingSession === s.id ? 'Aplicando...' : 'Aplicar'}
          </button>
        </div>
      ))}

      <TransactionTable
        transactions={filtered}
        categories={categories}
        accountNames={accountNames}
        onUpdate={updateTransaction}
        onDelete={deleteTransaction}
      />

      {showForm && <TransactionForm onSubmit={addTransaction} onClose={() => setShowForm(false)} titularNames={allTitulars} categories={categories} accountNames={accountNames} />}
      {showImport && (
        <ImportModal
          existingTransactions={transactions}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
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
