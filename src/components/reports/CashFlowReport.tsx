import { useState, useMemo } from 'react';
import { FileSpreadsheet, Download } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL, getMonthYear, getMonthLabel, getMonthYearOffset } from '../../lib/utils';

type Interval = 'mensal' | 'anual';

const CURRENT_YEAR = new Date().getFullYear();

function defaultStartForInterval(interval: Interval): string {
  if (interval === 'mensal') return getMonthYearOffset(getMonthYear(), -11);
  return String(CURRENT_YEAR - 2);
}

function defaultCountForInterval(interval: Interval): number {
  return interval === 'mensal' ? 12 : 3;
}

function maxCountForInterval(interval: Interval): number {
  return interval === 'mensal' ? 13 : 5;
}

export function CashFlowReport() {
  const { transactions, loading } = useTransactions();

  const [interval, setInterval] = useState<Interval>('mensal');
  const [startPeriod, setStartPeriod] = useState(() => defaultStartForInterval('mensal'));
  const [numPeriods, setNumPeriods] = useState<number>(12);

  function handleIntervalChange(next: Interval) {
    if (next === interval) return;
    setInterval(next);
    setStartPeriod(defaultStartForInterval(next));
    setNumPeriods(defaultCountForInterval(next));
  }

  function txPeriodKey(date: Date): string {
    if (interval === 'anual') return String(date.getFullYear());
    return getMonthYear(date);
  }

  function periodLabel(key: string): string {
    if (interval === 'anual') return key;
    return getMonthLabel(key);
  }

  const periods = useMemo(() => {
    if (interval === 'mensal') {
      return Array.from({ length: numPeriods }, (_, i) => getMonthYearOffset(startPeriod, i));
    }
    const startYear = parseInt(startPeriod, 10);
    if (Number.isNaN(startYear)) return [];
    return Array.from({ length: numPeriods }, (_, i) => String(startYear + i));
  }, [interval, startPeriod, numPeriods]);

  const { rows, saldoAnterior, totalEntradas, totalSaidas } = useMemo(() => {
    const firstPeriod = periods[0] ?? startPeriod;
    const saldoAnterior = transactions
      .filter((t) => txPeriodKey(t.date) < firstPeriod)
      .reduce((s, t) => s + t.amount, 0);

    let runningSaldo = saldoAnterior;
    const rows = periods.map((periodKey) => {
      const periodTxs = transactions.filter((t) => txPeriodKey(t.date) === periodKey);
      const entradas = periodTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const saidas = periodTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const resultado = entradas + saidas;
      runningSaldo += resultado;
      return { periodKey, label: periodLabel(periodKey), entradas, saidas, resultado, saldo: runningSaldo, empty: periodTxs.length === 0 };
    });

    return {
      rows,
      saldoAnterior,
      totalEntradas: rows.reduce((s, r) => s + r.entradas, 0),
      totalSaidas: rows.reduce((s, r) => s + r.saidas, 0),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, periods, interval, startPeriod]);

  const fileSuffix = `${startPeriod}_${numPeriods}${interval === 'mensal' ? 'm' : 'a'}`;

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const data = [
      ['Periodo', 'Entradas (R$)', 'Saidas (R$)', 'Resultado (R$)', 'Saldo (R$)'],
      ['Saldo anterior', '', '', '', saldoAnterior],
      ...rows.map((r) => [r.label, r.entradas, r.saidas, r.resultado, r.saldo]),
      ['Total', totalEntradas, totalSaidas, totalEntradas + totalSaidas, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa');
    XLSX.writeFile(wb, `fluxo_caixa_${fileSuffix}.xlsx`);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Fluxo de Caixa', 14, 15);
    doc.setFontSize(9);
    const unitLabel = interval === 'mensal' ? 'meses' : 'anos';
    doc.text(`${periodLabel(startPeriod)} · ${numPeriods} ${unitLabel}`, 14, 22);

    const body = [
      ['Saldo anterior', '—', '—', '—', formatBRL(saldoAnterior)],
      ...rows.map((r) => [r.label, formatBRL(r.entradas) || '—', formatBRL(r.saidas) || '—', formatBRL(r.resultado), formatBRL(r.saldo)]),
      ['Total', formatBRL(totalEntradas), formatBRL(totalSaidas), formatBRL(totalEntradas + totalSaidas), '—'],
    ];

    autoTable(doc, {
      startY: 27,
      head: [['Periodo', 'Entradas (R$)', 'Saidas (R$)', 'Resultado (R$)', 'Saldo (R$)']],
      body,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 35, halign: 'right' },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 35, halign: 'right' },
      },
    });

    doc.save(`fluxo_caixa_${fileSuffix}.pdf`);
  }

  if (loading) return <div className="text-accent text-sm animate-pulse">Carregando...</div>;

  const totalResultado = totalEntradas + totalSaidas;
  const hasData = rows.some((r) => !r.empty);
  const maxCount = maxCountForInterval(interval);

  return (
    <div className="space-y-3">
      {/* Range bar */}
      <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-bg-secondary border border-border rounded-lg">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Intervalo:</span>
          <div className="flex gap-1">
            {(['mensal', 'anual'] as Interval[]).map((opt) => (
              <button
                key={opt}
                onClick={() => handleIntervalChange(opt)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors capitalize ${
                  interval === opt
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'bg-bg-card border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <span className="text-border hidden sm:block">|</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Inicio:</span>
          {interval === 'mensal' ? (
            <input
              type="month"
              value={startPeriod}
              onChange={(e) => e.target.value && setStartPeriod(e.target.value)}
              className="bg-transparent text-text-primary text-xs focus:outline-none cursor-pointer border-none"
            />
          ) : (
            <input
              type="number"
              min={2000}
              max={CURRENT_YEAR}
              value={startPeriod}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setStartPeriod(v);
              }}
              className="w-20 bg-bg-card border border-border rounded px-2 py-0.5 text-text-primary text-xs focus:outline-none focus:border-accent"
            />
          )}
        </div>
        <span className="text-border hidden sm:block">|</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Qtde:</span>
          <input
            type="number"
            min={1}
            max={maxCount}
            value={numPeriods}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isNaN(n)) return;
              setNumPeriods(Math.min(Math.max(1, n), maxCount));
            }}
            className="w-14 bg-bg-card border border-border rounded px-2 py-0.5 text-text-primary text-xs focus:outline-none focus:border-accent"
          />
          <span className="text-text-secondary">{interval === 'mensal' ? `meses (máx ${maxCount})` : `anos (máx ${maxCount})`}</span>
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={exportExcel}
            disabled={!hasData}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-30"
            title="Exportar Excel"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={exportPDF}
            disabled={!hasData}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-30"
            title="Exportar PDF"
          >
            <Download size={13} /> PDF
          </button>
        </div>
      </div>

      {/* Table */}
      {!hasData ? (
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-sm">
          Nenhum lancamento no periodo selecionado.
        </div>
      ) : (
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

              {/* Period rows */}
              {rows.map((row) => (
                <tr
                  key={row.periodKey}
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
      )}
    </div>
  );
}
