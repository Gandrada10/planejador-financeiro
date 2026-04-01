import { useState, useMemo } from 'react';
import { CreditCard } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { MonthSelector } from '../shared/MonthSelector';
import { InvoiceSummaryPanel } from './InvoiceSummaryPanel';
import { InvoiceTransactionList } from './InvoiceTransactionList';
import { getMonthYear, getMonthYearOffset } from '../../lib/utils';

export function CreditCardPage() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const [selectedCardId, setSelectedCardId] = useState('');

  const { transactions, loading: loadingTx } = useTransactions();
  const { categories } = useCategories();
  const { cardAccounts, loading: loadingAccounts } = useAccounts();
  const { getCycleForCard, closeCycle, reopenCycle, registerPayment, ensureCycle } = useBillingCycles();

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
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <MonthSelector value={monthYear} onChange={setMonthYear} />
        </div>
      </div>

      {/* Cycle status badge */}
      {currentCycle && (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold ${
          currentCycle.status === 'closed'
            ? 'bg-accent-red/10 text-accent-red'
            : 'bg-accent-green/10 text-accent-green'
        }`}>
          {currentCycle.status === 'closed' ? 'Fatura encerrada' : 'Fatura aberta'}
        </div>
      )}

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
            totalTransactions={invoiceTransactions.length}
          />
        </div>
      </div>
    </div>
  );
}
