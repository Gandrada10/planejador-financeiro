import { useState, useMemo } from 'react';
import { FileSpreadsheet, Download } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL, getMonthYear, getMonthLabel, getMonthYearOffset } from '../../lib/utils';

const PERIOD_OPTIONS = [3, 6, 12, 24] as const;

export function CashFlowReport() {
  const { transactions, loading } = useTransactions();

  const firstTxMonth = useMemo(() => {
    if (transactions.length === 0) return getMonthYearOffset(getMonthYear(), -11);
    return [...transactions.map((t) => getMonthYear(t.date))].sort()[0];
  }, [transactions]);

  const [startMonth, setStartMonth] = useState(() => getMonthYearOffset(getMonthYear(), -11));
  const [numMonths, setNumMonths] = useState<number>(12);

  const months = useMemo(
    () => Array.from({ length: numMonths }, (_, i) => getMonthYearOffset(startMonth, i)),
    [startMonth, numMonths]
  );

  const { rows, saldoAnterior, totalEntradas, totalSaidas } = useMemo(() => {
    const saldoAnterior = transactions
      .filter((t) => getMonthYear(t.date) < startMonth)
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

    return {
      rows,
      saldoAnterior,
      totalEntradas: rows.reduce((s, r) => s + r.entradas, 0),
      totalSaidas: rows.reduce((s, r) => s + r.saidas, 0),
    };
  }, [transactions, months, startMonth]);

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
    XLSX.writeFile(wb, `fluxo_caixa_${startMonth}_${numMonths}m.xlsx`);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Fluxo de Caixa', 14, 15);
    doc.setFontSize(9);
    doc.text(`${getMonthLabel(startMonth)} · ${numMonths} meses`, 14, 22);

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

    doc.save(`fluxo_caixa_${startMonth}_${numMonths}m.pdf`);
  }

  if (loading) return <div className="text-accent text-sm animate-pulse">Carregando...</div>;

  const totalResultado = totalEntradas + totalSaidas;
  const hasData = rows.some((r) => !r.empty);

  return (
    <div className="space-y-3">
      {/* Range bar */}
      <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-bg-secondary border border-border rounded-lg">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Inicio:</span>
          <input
            type="month"
            value={startMonth}
            min={firstTxMonth}
            onChange={(e) => e.target.value && setStartMonth(e.target.value)}
            className="bg-transparent text-text-primary text-xs focus:outline-none cursor-pointer border-none"
          />
        </div>
        <span className="text-border hidden sm:block">|</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Periodo:</span>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setNumMonths(n)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  numMonths === n
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'bg-bg-card border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {n}m
              </button>
            ))}
          </div>
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
      )}
    </div>
  );
}
