import { useState, useMemo, useCallback } from 'react';
import { CreditCard, LockOpen } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel';
import { InvoiceTransactionList } from './InvoiceTransactionList';
import { formatBRL, getMonthYear, getMonthYearOffset, getMonthLabel } from '../../lib/utils';

export function CreditCardPage() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const [selectedCardId, setSelectedCardId] = useState('');

  const { transactions, loading: loadingTx, updateTransaction, deleteTransaction, batchUpdateReconciled } = useTransactions();
  const { categories, rules, addRule, updateRule } = useCategories();
  const { cardAccounts, loading: loadingAccounts } = useAccounts();
  const { getCycleForCard, closeCycle, reopenCycle, registerPayment, ensureCycle, getClosedCycle } = useBillingCycles();
  const { activeProjects } = useProjects();

  // Auto-select first card
  const activeCardId = selectedCardId || cardAccounts[0]?.id || '';
  const activeCard = cardAccounts.find((a) => a.id === activeCardId);

  // Get transactions for this card + month
  const invoiceTransactions = useMemo(() => {
    if (!activeCard) return [];
    return transactions.filter((t) => {
      if (t.account !== activeCard.name) return false;
      return getMonthYear(t.date) === monthYear;
    });
  }, [transactions, activeCard, monthYear]);

  // Group by titular
  const titularGroups = useMemo(() => {
    const map = new Map<string, typeof invoiceTransactions>();
    for (const t of invoiceTransactions) {
      const key = t.titular || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries())
      .map(([titular, txs]) => ({
        titular,
        total: txs.reduce((s, t) => s + t.amount, 0),
        transactions: txs.sort((a, b) => a.date.getTime() - b.date.getTime()),
      }))
      .sort((a, b) => a.total - b.total);
  }, [invoiceTransactions]);

  // Totals
  const totalExpenses = invoiceTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const totalCredits = invoiceTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalInvoice = totalExpenses + totalCredits;

  // Previous balance (from previous month cycle)
  const previousBalance = useMemo(() => {
    if (!activeCard) return 0;
    const prevMonth = getMonthYearOffset(monthYear, -1);
    const prevCycle = getCycleForCard(activeCard.id, prevMonth);
    if (!prevCycle) return 0;
    // Sum previous month transactions
    const prevTxs = transactions.filter(
      (t) => t.account === activeCard.name && getMonthYear(t.date) === prevMonth
    );
    const prevTotal = prevTxs.reduce((s, t) => s + t.amount, 0);
    const prevPaid = prevCycle.paidAmount || 0;
    const remaining = prevTotal + prevPaid; // prevTotal is negative, prevPaid is positive
    return remaining < 0 ? remaining : 0; // only carry forward if there's a balance
  }, [activeCard, monthYear, transactions, getCycleForCard]);

  // Titular totals for summary
  const titularTotals = titularGroups.map((g) => ({ name: g.titular, total: g.total }));

  // Future installments
  const futureInstallments = useMemo(() => {
    return invoiceTransactions.filter(
      (t) => t.totalInstallments && t.installmentNumber && t.installmentNumber < t.totalInstallments
    );
  }, [invoiceTransactions]);

  const futureInstallmentsTotal = futureInstallments.reduce((s, t) => s + t.amount, 0);

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  // Current cycle
  const currentCycle = activeCard ? getCycleForCard(activeCard.id, monthYear) : undefined;

  // Other open invoices (any card+month combo with transactions that aren't closed, excluding current view)
  const otherOpenInvoices = useMemo(() => {
    const combos = new Map<string, { accountId: string; accountName: string; monthYear: string; total: number }>();
    for (const t of transactions) {
      const account = cardAccounts.find((a) => a.name === t.account);
      if (!account) continue;
      const my = getMonthYear(t.date);
      const key = `${account.id}|${my}`;
      if (!combos.has(key)) {
        combos.set(key, { accountId: account.id, accountName: account.name, monthYear: my, total: 0 });
      }
      combos.get(key)!.total += t.amount;
    }
    return Array.from(combos.values())
      .filter((c) => {
        // Exclude current view
        if (c.accountId === activeCardId && c.monthYear === monthYear) return false;
        // Exclude closed cycles
        const cycle = getCycleForCard(c.accountId, c.monthYear);
        if (cycle?.status === 'closed') return false;
        return true;
      })
      .sort((a, b) => b.monthYear.localeCompare(a.monthYear));
  }, [transactions, cardAccounts, activeCardId, monthYear, getCycleForCard]);

  async function handleCloseCycle() {
    if (!activeCard) return;
    const [y, m] = monthYear.split('-').map(Number);
    const cycleId = await ensureCycle(activeCard.id, new Date(y, m - 1, 1));
    if (cycleId) await closeCycle(cycleId);
  }

  async function handleReopenCycle() {
    if (currentCycle) await reopenCycle(currentCycle.id);
  }

  async function handleRegisterPayment(amount: number, date: Date) {
    if (!activeCard) return;
    const [y, m] = monthYear.split('-').map(Number);
    const cycleId = await ensureCycle(activeCard.id, new Date(y, m - 1, 1));
    if (cycleId) await registerPayment(cycleId, amount, date);
  }

  async function handleBatchMove(ids: string[], targetMonthYear: string) {
    const [y, m] = targetMonthYear.split('-').map(Number);
    for (const id of ids) {
      const tx = transactions.find((t) => t.id === id);
      if (!tx) continue;
      const newDate = new Date(tx.date);
      newDate.setFullYear(y);
      newDate.setMonth(m - 1);
      await updateTransaction(id, { date: newDate });
    }
  }

  function checkClosedCycleForTx(t: { account: string; date: Date }): { cycleId: string; label: string } | null {
    const account = cardAccounts.find((a) => a.name === t.account);
    if (!account) return null;
    const closed = getClosedCycle(account.id, t.date);
    if (!closed) return null;
    return { cycleId: closed.id, label: `${account.name} — ${getMonthLabel(closed.monthYear)}` };
  }

  const handleCreateRule = useCallback(async (description: string, categoryId: string) => {
    const existing = rules.find((r) => r.pattern.toLowerCase() === description.toLowerCase());
    if (existing) {
      await updateRule(existing.id, { categoryId });
    } else {
      await addRule({ pattern: description, keywords: [], categoryId });
    }
  }, [rules, addRule, updateRule]);

  if (loadingTx || loadingAccounts) {
    return <div className="text-accent text-sm animate-pulse">Carregando cartoes...</div>;
  }

  if (cardAccounts.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-text-primary">Cartoes de Credito</h2>
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center">
          <CreditCard size={32} className="mx-auto mb-3 text-text-secondary" />
          <p className="text-sm text-text-secondary">Nenhum cartao de credito cadastrado.</p>
          <p className="text-xs text-text-secondary mt-1">Cadastre um cartao do tipo "Cartao de Credito" em Configuracoes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Cartoes de Credito</h2>
        <div className="flex items-center gap-3">
          {/* Card selector */}
          <select
            value={activeCardId}
            onChange={(e) => setSelectedCardId(e.target.value)}
            className="px-3 py-1.5 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          >
            {cardAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.dueDay ? ` (venc. dia ${a.dueDay})` : ''}</option>
            ))}
          </select>
          <MonthSelector value={monthYear} onChange={setMonthYear} months={availableMonths} />
        </div>
      </div>

      {/* Cycle status badge + due date */}
      <div className="flex items-center gap-3 flex-wrap">
        {currentCycle && (
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold ${
            currentCycle.status === 'closed'
              ? 'bg-accent-red/10 text-accent-red'
              : 'bg-accent-green/10 text-accent-green'
          }`}>
            {currentCycle.status === 'closed' ? 'Fatura encerrada' : 'Fatura aberta'}
          </div>
        )}
        {activeCard?.dueDay && (
          <span className="text-[10px] text-text-secondary">Vencimento: dia {activeCard.dueDay}</span>
        )}
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {/* Left: Summary */}
        <div className="lg:col-span-2 space-y-4">
          {activeCard && (
            <InvoiceSummaryPanel
              account={activeCard}
              cycle={currentCycle}
              monthYear={monthYear}
              totalExpenses={totalExpenses}
              totalCredits={totalCredits}
              totalInvoice={totalInvoice}
              previousBalance={previousBalance}
              titularTotals={titularTotals}
              futureInstallmentsCount={futureInstallments.length}
              futureInstallmentsTotal={futureInstallmentsTotal}
              onCloseCycle={handleCloseCycle}
              onReopenCycle={handleReopenCycle}
              onRegisterPayment={handleRegisterPayment}
            />
          )}

          {/* Other open invoices */}
          <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
              <LockOpen size={13} className="text-accent-green" /> Outras faturas em aberto
            </h3>
            {otherOpenInvoices.length === 0 ? (
              <p className="text-[11px] text-text-secondary">Nenhuma outra fatura em aberto.</p>
            ) : (
              <div className="space-y-1.5">
                {otherOpenInvoices.map((inv) => {
                  const isSameCard = inv.accountId === activeCardId;
                  return (
                    <button
                      key={`${inv.accountId}|${inv.monthYear}`}
                      onClick={() => {
                        if (!isSameCard) setSelectedCardId(inv.accountId);
                        setMonthYear(inv.monthYear);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 bg-bg-secondary rounded border border-border/40 hover:border-accent text-left transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-text-primary truncate">{inv.accountName}</p>
                        <p className="text-[10px] text-text-secondary capitalize">{getMonthLabel(inv.monthYear)}</p>
                      </div>
                      <span className={`text-[11px] font-bold font-mono flex-shrink-0 ${inv.total < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                        {formatBRL(inv.total)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Transaction list */}
        <div className="lg:col-span-5">
          <InvoiceTransactionList
            groups={titularGroups}
            categories={categories}
            projects={activeProjects}
            totalTransactions={invoiceTransactions.length}
            availableMonths={availableMonths}
            currentMonthYear={monthYear}
            onUpdate={updateTransaction}
            onDelete={deleteTransaction}
            onBatchReconcile={batchUpdateReconciled}
            onBatchMove={handleBatchMove}
            checkClosedCycle={checkClosedCycleForTx}
            reopenCycle={reopenCycle}
            onCreateRule={handleCreateRule}
            rules={rules}
          />
        </div>
      </div>

    </div>
  );
}
