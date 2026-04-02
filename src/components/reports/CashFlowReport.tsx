import { useMemo } from 'react';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL, getMonthYear, getMonthLabel, getMonthYearOffset } from '../../lib/utils';

export function CashFlowReport() {
  const { transactions, loading } = useTransactions();

  const { rows, saldoAnterior, totalEntradas, totalSaidas } = useMemo(() => {
    if (transactions.length === 0) {
      return { rows: [], saldoAnterior: 0, totalEntradas: 0, totalSaidas: 0 };
    }

    // Find range: first transaction month → current month
    const allMonthYears = transactions.map((t) => getMonthYear(t.date));
    const firstMonth = [...allMonthYears].sort()[0];
    const currentMonth = getMonthYear();

    // Build continuous month list from first to current
    const months: string[] = [];
    let cursor = firstMonth;
    while (cursor <= currentMonth) {
      months.push(cursor);
      cursor = getMonthYearOffset(cursor, 1);
    }

    // Saldo anterior: sum of all transactions before first displayed month
    const saldoAnterior = transactions
      .filter((t) => getMonthYear(t.date) < firstMonth)
      .reduce((s, t) => s + t.amount, 0);

    let runningSaldo = saldoAnterior;
    const rows = months.map((monthYear) => {
      const monthTxs = transactions.filter((t) => getMonthYear(t.date) === monthYear);
      const entradas = monthTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const saidas = monthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const resultado = entradas + saidas;
      runningSaldo += resultado;
      return { monthYear, label: getMonthLabel(monthYear), entradas, saidas, resultado, saldo: runningSaldo, empty: monthTxs.length === 0 };
    });

    const totalEntradas = rows.reduce((s, r) => s + r.entradas, 0);
    const totalSaidas = rows.reduce((s, r) => s + r.saidas, 0);

    return { rows, saldoAnterior, totalEntradas, totalSaidas };
  }, [transactions]);

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-sm">
        Nenhum lancamento encontrado.
      </div>
    );
  }

  const totalResultado = totalEntradas + totalSaidas;

  return (
    <div className="overflow-x-auto bg-bg-card border border-border rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-text-secondary text-[10px] uppercase tracking-wider">
            <th className="p-3 text-left min-w-[160px]">Periodo</th>
            <th className="p-3 text-right min-w-[130px]">Entradas (R$)</th>
            <th className="p-3 text-right min-w-[130px]">Saidas (R$)</th>
            <th className="p-3 text-right min-w-[130px]">Resultado (R$)</th>
            <th className="p-3 text-right min-w-[130px]">Saldo (R$)</th>
          </tr>
        </thead>
        <tbody>
          {/* Saldo anterior */}
          <tr className="border-b border-border/40 bg-bg-secondary/30">
            <td className="p-3 text-text-secondary font-bold">Saldo anterior</td>
            <td className="p-3 text-right text-text-secondary">—</td>
            <td className="p-3 text-right text-text-secondary">—</td>
            <td className="p-3 text-right text-text-secondary">—</td>
            <td className={`p-3 text-right font-bold font-mono ${saldoAnterior >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {formatBRL(saldoAnterior)}
            </td>
          </tr>

          {/* Month rows */}
          {rows.map((row) => (
            <tr
              key={row.monthYear}
              className={`border-b border-border/20 transition-colors hover:bg-bg-secondary/20 ${row.empty ? 'opacity-40' : ''}`}
            >
              <td className="p-3 text-text-primary capitalize">{row.label}</td>
              <td className="p-3 text-right font-mono text-accent-green">
                {row.entradas > 0 ? formatBRL(row.entradas) : <span className="text-text-secondary">—</span>}
              </td>
              <td className="p-3 text-right font-mono text-accent-red">
                {row.saidas < 0 ? formatBRL(row.saidas) : <span className="text-text-secondary">—</span>}
              </td>
              <td className={`p-3 text-right font-mono ${row.resultado === 0 ? 'text-text-secondary' : row.resultado > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {row.resultado === 0 ? '—' : formatBRL(row.resultado)}
              </td>
              <td className={`p-3 text-right font-bold font-mono ${row.saldo >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(row.saldo)}
              </td>
            </tr>
          ))}

          {/* Total row */}
          <tr className="border-t-2 border-border bg-bg-secondary/40">
            <td className="p-3 font-bold text-text-primary uppercase text-[10px] tracking-wider">Total</td>
            <td className="p-3 text-right font-bold font-mono text-accent-green">{formatBRL(totalEntradas)}</td>
            <td className="p-3 text-right font-bold font-mono text-accent-red">{formatBRL(totalSaidas)}</td>
            <td className={`p-3 text-right font-bold font-mono ${totalResultado >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {formatBRL(totalResultado)}
            </td>
            <td className="p-3 text-right text-text-secondary">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
