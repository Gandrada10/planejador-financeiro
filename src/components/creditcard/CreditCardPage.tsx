import { useState, useMemo, useCallback } from 'react';
import { CreditCard, Lock } from 'lucide-react';
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
  const { cycles, getCycleForCard, closeCycle, reopenCycle, registerPayment, ensureCycle, getClosedCycle } = useBillingCycles();
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

  async function handleCloseCycle() {
    if (!activeCard) return;
    await ensureCycle(activeCard.id, new Date(parseInt(monthYear.split('-')[0]), parseInt(monthYear.split('-')[1]) - 1, 1));
    const cycle = getCycleForCard(activeCard.id, monthYear);
    if (cycle) await closeCycle(cycle.id);
  }

  async function handleReopenCycle() {
    if (currentCycle) await reopenCycle(currentCycle.id);
  }

  async function handleRegisterPayment(amount: number, date: Date) {
    if (!activeCard) return;
    await ensureCycle(activeCard.id, new Date(parseInt(monthYear.split('-')[0]), parseInt(monthYear.split('-')[1]) - 1, 1));
    const cycle = getCycleForCard(activeCard.id, monthYear);
    if (cycle) await registerPayment(cycle.id, amount, date);
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
        <div className="lg:col-span-2">
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

      {/* Closed invoices overview — all cards */}
      {(() => {
        const closedItems = cycles
          .filter((c) => c.status === 'closed')
          .map((cycle) => {
            const account = cardAccounts.find((a) => a.id === cycle.accountId);
            if (!account) return null;
            const cycleTxs = transactions.filter(
              (t) => t.account === account.name && getMonthYear(t.date) === cycle.monthYear
            );
            const total = cycleTxs.reduce((s, t) => s + t.amount, 0);
            const paid = cycle.paidAmount || 0;
            const remaining = total + paid; // total is negative, paid is positive
            return { cycle, account, total, paid, remaining };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => b.cycle.monthYear.localeCompare(a.cycle.monthYear));

        const grandTotal = closedItems.reduce((s, i) => s + i.total, 0);

        return (
          <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <Lock size={15} className="text-accent" /> Visao Geral das Faturas Fechadas
              </h3>
              {closedItems.length > 0 && (
                <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                  <span>
                    {closedItems.length} fatura{closedItems.length !== 1 ? 's' : ''} encerrada{closedItems.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-accent-red font-bold">{formatBRL(grandTotal)}</span>
                </div>
              )}
            </div>

            {closedItems.length === 0 ? (
              <p className="text-xs text-text-secondary">Nenhuma fatura encerrada ate o momento.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {closedItems.map(({ cycle, account, total, paid, remaining }) => (
                  <div
                    key={cycle.id}
                    className="bg-bg-secondary rounded p-3 space-y-2 border border-border/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-primary truncate">{account.name}</p>
                        <p className="text-[10px] text-text-secondary uppercase tracking-wider">
                          {getMonthLabel(cycle.monthYear)}
                        </p>
                      </div>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-accent-red/10 text-accent-red flex-shrink-0">
                        <Lock size={10} /> Encerrada
                      </span>
                    </div>

                    <div className="space-y-1 pt-2 border-t border-border/40 text-xs">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Total</span>
                        <span className="text-accent-red font-bold">{formatBRL(total)}</span>
                      </div>
                      {paid > 0 && (
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Pago</span>
                          <span className="text-accent-green font-bold">{formatBRL(paid)}</span>
                        </div>
                      )}
                      {paid > 0 && (
                        <div className="flex justify-between pt-1 border-t border-border/30">
                          <span className="text-text-secondary">Saldo</span>
                          <span className={`font-bold ${remaining < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                            {formatBRL(remaining)}
                          </span>
                        </div>
                      )}
                      {cycle.closedAt && (
                        <div className="flex justify-between text-[10px] text-text-secondary pt-1">
                          <span>Encerrada em</span>
                          <span>{new Intl.DateTimeFormat('pt-BR').format(cycle.closedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
