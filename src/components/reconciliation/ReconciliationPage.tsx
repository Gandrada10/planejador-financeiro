import { useState, useMemo } from 'react';
import { CheckCircle } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { MonthSelector } from '../shared/MonthSelector';
import { ReconciliationTable } from './ReconciliationTable';
import { getMonthYear, formatBRL, parseMoneyInput, applyMoneyMask } from '../../lib/utils';

export function ReconciliationPage() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const [selectedAccount, setSelectedAccount] = useState('');
  const [statementBalance, setStatementBalance] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'reconciled' | 'unreconciled'>('all');

  const { transactions, loading, updateTransaction, batchUpdateReconciled } = useTransactions();
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  // Filter transactions by account + month
  const accountTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions.filter((t) => {
      if (t.account !== selectedAccount) return false;
      return getMonthYear(t.date) === monthYear;
    });
  }, [transactions, selectedAccount, monthYear]);

  // Apply status filter
  const filtered = useMemo(() => {
    if (filterStatus === 'all') return accountTransactions;
    if (filterStatus === 'reconciled') return accountTransactions.filter((t) => t.reconciled);
    return accountTransactions.filter((t) => !t.reconciled);
  }, [accountTransactions, filterStatus]);

  // Summary calculations
  const systemTotal = useMemo(
    () => accountTransactions.reduce((s, t) => s + t.amount, 0),
    [accountTransactions]
  );

  const reconciledCount = useMemo(
    () => accountTransactions.filter((t) => t.reconciled).length,
    [accountTransactions]
  );

  const totalCount = accountTransactions.length;

  // Campo mascarado na entrada (applyMoneyMask), então parseMoneyInput recebe
  // formato pt-BR canônico. GUARD: só parseia quando há dígito — parseMoneyInput
  // cai em 0 pra texto não numérico, o que mostraria uma divergência falsa
  // contra R$0. Sem dígito = sem saldo informado (null).
  const parsedBalance = /\d/.test(statementBalance) ? parseMoneyInput(statementBalance) : null;
  const divergence = parsedBalance !== null && !isNaN(parsedBalance) ? parsedBalance - systemTotal : null;

  function handleToggleReconciled(id: string, reconciled: boolean) {
    updateTransaction(id, { reconciled, reconciledAt: reconciled ? new Date() : null });
  }

  function handleReconcileAll() {
    const pendingIds = accountTransactions.filter((t) => !t.reconciled).map((t) => t.id);
    if (pendingIds.length === 0) return;
    if (!window.confirm(`Marcar ${pendingIds.length} transacoes como conciliadas?`)) return;
    batchUpdateReconciled(pendingIds, true);
  }

  function handleUnreconcileAll() {
    const reconciledIds = accountTransactions.filter((t) => t.reconciled).map((t) => t.id);
    if (reconciledIds.length === 0) return;
    if (!window.confirm(`Desmarcar ${reconciledIds.length} transacoes conciliadas?`)) return;
    batchUpdateReconciled(reconciledIds, false);
  }

  const progressPercent = totalCount > 0 ? Math.round((reconciledCount / totalCount) * 100) : 0;

  if (loading) {
    return <div className="text-accent text-body animate-pulse">Carregando conciliacao...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Conciliacao Bancaria</h2>
        <MonthSelector value={monthYear} onChange={setMonthYear} />
      </div>

      {/* Account selector + statement balance */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-caption text-ink-3 uppercase tracking-wider mb-1">Conta</label>
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent"
          >
            <option value="">Selecione uma conta...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.name}>{a.name} ({a.bank})</option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label className="block text-caption text-ink-3 uppercase tracking-wider mb-1">Saldo do Extrato</label>
          <input
            type="text"
            inputMode="decimal"
            value={statementBalance}
            onChange={(e) => setStatementBalance(applyMoneyMask(e.target.value))}
            placeholder="Ex: -1234,56"
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent"
          />
        </div>

        {selectedAccount && (
          <div className="flex gap-2">
            <button
              onClick={handleReconcileAll}
              className="px-3 py-2 bg-accent-green/10 text-accent-green text-body rounded-control hover:bg-accent-green/20 transition-colors"
            >
              Conciliar Tudo
            </button>
            <button
              onClick={handleUnreconcileAll}
              className="px-3 py-2 bg-bg-secondary border border-border text-text-secondary text-body rounded-control hover:border-accent transition-colors"
            >
              Limpar Tudo
            </button>
          </div>
        )}
      </div>

      {/* Summary cards — padrão de tile do VitalSigns: rótulo → número-herói */}
      {selectedAccount && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Sistema */}
          <div className="bg-bg-card border border-border rounded-card px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">Total Sistema</span>
            <span className={`text-[21px] font-bold tracking-tight tnum leading-none truncate ${systemTotal >= 0 ? 'text-positive' : 'text-negative'}`}>
              {formatBRL(systemTotal)}
            </span>
          </div>

          {/* Saldo Extrato */}
          <div className="bg-bg-card border border-border rounded-card px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">Saldo Extrato</span>
            <span className="text-[21px] font-bold tracking-tight tnum leading-none truncate text-text-primary">
              {parsedBalance !== null && !isNaN(parsedBalance) ? formatBRL(parsedBalance) : '—'}
            </span>
          </div>

          {/* Divergencia */}
          <div className="bg-bg-card border border-border rounded-card px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">Divergencia</span>
            {divergence !== null ? (
              <span className={`text-[21px] font-bold tracking-tight tnum leading-none truncate ${Math.abs(divergence) < 0.01 ? 'text-positive' : 'text-negative'}`}>
                {formatBRL(divergence)}
              </span>
            ) : (
              <span className="text-[21px] font-bold tracking-tight tnum leading-none text-text-secondary">—</span>
            )}
          </div>

          {/* Progresso */}
          <div className="bg-bg-card border border-border rounded-card px-3 py-3 flex flex-col gap-1 min-w-0">
            <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">Progresso</span>
            <span className="text-[21px] font-bold tracking-tight tnum leading-none truncate text-text-primary">
              {reconciledCount}/{totalCount}
              <span className="text-caption font-medium text-text-secondary tracking-normal"> ({progressPercent}%)</span>
            </span>
            <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-positive rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Filter buttons */}
      {selectedAccount && totalCount > 0 && (
        <div className="flex gap-2">
          {(['all', 'unreconciled', 'reconciled'] as const).map((status) => {
            const labels = { all: 'Todos', reconciled: 'Conciliados', unreconciled: 'Pendentes' };
            const counts = {
              all: totalCount,
              reconciled: reconciledCount,
              unreconciled: totalCount - reconciledCount,
            };
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 text-body rounded-control transition-colors ${
                  filterStatus === status
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'bg-bg-secondary border border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {labels[status]} ({counts[status]})
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!selectedAccount && (
        <div className="bg-bg-card border border-border rounded-card p-10 text-center">
          <CheckCircle size={32} className="mx-auto mb-3 text-text-secondary" />
          <p className="text-body text-text-secondary">Selecione uma conta para iniciar a conciliacao.</p>
          <p className="text-caption text-text-secondary mt-1">
            Compare as transacoes do sistema com seu extrato bancario fisico.
          </p>
        </div>
      )}

      {/* Transaction table */}
      {selectedAccount && (
        <ReconciliationTable
          transactions={filtered}
          categories={categories}
          onToggleReconciled={handleToggleReconciled}
        />
      )}
    </div>
  );
}
