import { useState, useMemo, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Download } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL, getMonthYear, getMonthYearOffset } from '../../lib/utils';
import type { Category } from '../../types';

type Interval = 'mensal' | 'anual';

function shortMonthLabel(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  const m = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date);
  return `${m.replace('.', '')}'${String(year).slice(2)}`;
}

function avg(values: number[]): number {
  const nonZero = values.filter((v) => v !== 0);
  if (nonZero.length === 0) return 0;
  return nonZero.reduce((s, v) => s + v, 0) / nonZero.length;
}

type HeatmapKind = 'income' | 'expense';

/**
 * Gera um background-color relativo baseado na intensidade do valor dentro da linha.
 * Intensidade = |value| / max(|rowMin|, |rowMax|), clamp [0, 1].
 * Usa color-mix com --color-accent-green (income) ou --color-accent-red (expense),
 * com opacidade máxima de 35% para não prejudicar contraste do texto.
 */
function getHeatmapStyle(value: number, rowMax: number, kind: HeatmapKind): CSSProperties {
  if (value === 0 || rowMax === 0) return {};
  const intensity = Math.min(Math.abs(value) / Math.abs(rowMax), 1);
  if (intensity < 0.05) return {};
  const pct = Math.round(intensity * 35);
  const varName = kind === 'income' ? '--color-accent-green' : '--color-accent-red';
  return {
    backgroundColor: `color-mix(in oklab, var(${varName}) ${pct}%, transparent)`,
  };
}

interface CatRowProps {
  category?: Category | null;
  label: string;
  icon: string;
  color?: string;
  indent: number;
  monthTotals: Record<string, number>;
  months: string[];
  isExpanded?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
  sectionTotals?: Record<string, number>;
  rowClassName?: string;
  heatmapKind?: HeatmapKind;
}

function CatRow({ label, icon, color, indent, monthTotals, months, isExpanded, hasChildren, onToggle, sectionTotals, rowClassName, heatmapKind }: CatRowProps) {
  const values = months.map((m) => monthTotals[m] ?? 0);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);
  const rowMax = Math.max(...values.map((v) => Math.abs(v)), 0);

  return (
    <tr className={`border-b border-border/20 ${rowClassName || ''} ${onToggle ? 'cursor-pointer hover:bg-bg-secondary/30 transition-colors' : ''}`} onClick={onToggle}>
      <td className="p-0 sticky left-0 z-10 bg-inherit">
        <div className="flex items-center gap-1.5 px-2 py-1 whitespace-nowrap" style={{ paddingLeft: `${10 + indent * 16}px` }}>
          {hasChildren !== undefined && (
            <span className="w-3 flex-shrink-0 text-text-secondary">
              {hasChildren
                ? isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
                : <span className="w-3" />}
            </span>
          )}
          {icon && (
            <span style={{ color }} className="flex-shrink-0 leading-none">
              <CategoryIcon icon={icon} size={13} />
            </span>
          )}
          <span className="text-xs text-text-primary">{label}</span>
        </div>
      </td>

      {months.map((m) => {
        const val = monthTotals[m] ?? 0;
        const sectionTotal = sectionTotals?.[m] ?? 0;
        const pct = sectionTotal !== 0 ? (Math.abs(val) / Math.abs(sectionTotal)) * 100 : 0;
        const heatStyle = heatmapKind ? getHeatmapStyle(val, rowMax, heatmapKind) : {};
        return (
          <td
            key={m}
            className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap align-top min-w-[100px]"
            style={heatStyle}
          >
            {val !== 0 ? (
              <>
                <div className={`text-xs ${val >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(val)}</div>
                {sectionTotals && pct > 0 && (
                  <div className="text-[9px] text-text-secondary">{pct.toFixed(1)}%</div>
                )}
              </>
            ) : <span className="text-[10px] text-text-secondary/40">—</span>}
          </td>
        );
      })}

      <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap min-w-[100px] bg-bg-secondary/20">
        {average !== 0
          ? <span className={`text-xs ${average >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(average)}</span>
          : <span className="text-[10px] text-text-secondary/40">—</span>}
      </td>
      <td className="px-2 py-1 text-right font-bold font-mono tabular-nums whitespace-nowrap min-w-[110px] bg-bg-secondary/30">
        {total !== 0
          ? <span className={`text-xs ${total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(total)}</span>
          : <span className="text-[10px] text-text-secondary/40">—</span>}
      </td>
    </tr>
  );
}

function SectionHeaderRow({ label, months, monthTotals, colorClass }: {
  label: string; months: string[]; monthTotals: Record<string, number>; colCount: number; colorClass: string;
}) {
  const values = months.map((m) => monthTotals[m] ?? 0);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);
  return (
    <tr className="bg-bg-secondary/60 border-y border-border">
      <td className="px-2 py-1.5 pl-3 sticky left-0 z-10 bg-bg-secondary/60">
        <span className={`text-xs font-bold uppercase tracking-wider ${colorClass}`}>{label}</span>
      </td>
      {months.map((m) => {
        const val = monthTotals[m] ?? 0;
        return (
          <td key={m} className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap">
            {val !== 0 ? <span className={`text-xs ${colorClass}`}>{formatBRL(val)}</span> : <span className="text-[10px] text-text-secondary/40">—</span>}
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap bg-bg-secondary/20">
        {average !== 0 && <span className={`text-xs ${colorClass}`}>{formatBRL(average)}</span>}
      </td>
      <td className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap bg-bg-secondary/40">
        {total !== 0 && <span className={`text-xs ${colorClass}`}>{formatBRL(total)}</span>}
      </td>
    </tr>
  );
}

function ResultadoRow({ months, receitas, despesas }: {
  months: string[]; receitas: Record<string, number>; despesas: Record<string, number>;
}) {
  const resultados: Record<string, number> = {};
  for (const m of months) resultados[m] = (receitas[m] ?? 0) + (despesas[m] ?? 0);
  const values = months.map((m) => resultados[m]);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);
  return (
    <tr className="bg-bg-secondary/80 border-t-2 border-border">
      <td className="px-2 py-1.5 pl-3 sticky left-0 z-10 bg-bg-secondary/80">
        <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Resultado</span>
      </td>
      {months.map((m) => {
        const val = resultados[m] ?? 0;
        return (
          <td key={m} className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap">
            {val !== 0 ? <span className={`text-xs ${val >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(val)}</span> : <span className="text-[10px] text-text-secondary/40">—</span>}
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap bg-bg-secondary/20">
        {average !== 0 && <span className={`text-xs ${average >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(average)}</span>}
      </td>
      <td className="px-2 py-1.5 text-right font-bold font-mono tabular-nums whitespace-nowrap bg-bg-secondary/40">
        {total !== 0 && <span className={`text-xs ${total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(total)}</span>}
      </td>
    </tr>
  );
}

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

export function CategoryEvolutionReport() {
  const { transactions, loading } = useTransactions();
  const { rootCategories, subCategories } = useCategories();

  const [interval, setInterval] = useState<Interval>('mensal');
  const [startPeriod, setStartPeriod] = useState(() => defaultStartForInterval('mensal'));
  const [numPeriods, setNumPeriods] = useState<number>(12);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

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
    return shortMonthLabel(key);
  }

  const periods = useMemo(() => {
    if (interval === 'mensal') {
      return Array.from({ length: numPeriods }, (_, i) => getMonthYearOffset(startPeriod, i));
    }
    const startYear = parseInt(startPeriod, 10);
    if (Number.isNaN(startYear)) return [];
    return Array.from({ length: numPeriods }, (_, i) => String(startYear + i));
  }, [interval, startPeriod, numPeriods]);

  const monthlyByCat = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    const periodSet = new Set(periods);
    for (const t of transactions) {
      const key = txPeriodKey(t.date);
      if (!periodSet.has(key)) continue;
      const catId = t.categoryId || '__none';
      if (!result[catId]) result[catId] = {};
      result[catId][key] = (result[catId][key] || 0) + t.amount;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, periods, interval]);

  function sumForIds(ids: string[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const p of periods) result[p] = ids.reduce((s, id) => s + (monthlyByCat[id]?.[p] || 0), 0);
    return result;
  }

  const sectionTotals = useMemo(() => {
    const receitas: Record<string, number> = {};
    const despesas: Record<string, number> = {};
    const periodSet = new Set(periods);
    for (const p of periods) {
      receitas[p] = 0;
      despesas[p] = 0;
    }
    for (const t of transactions) {
      const key = txPeriodKey(t.date);
      if (!periodSet.has(key)) continue;
      if (t.amount > 0) receitas[key] += t.amount;
      else if (t.amount < 0) despesas[key] += t.amount;
    }
    return { receitas, despesas };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, periods, interval]);

  const { incomeCats, expenseCats } = useMemo(() => {
    const incomeCats: Category[] = [];
    const expenseCats: Category[] = [];
    const ambosIncome: Category[] = [];
    const ambosExpense: Category[] = [];
    for (const cat of rootCategories) {
      if (cat.type === 'receita') incomeCats.push(cat);
      else if (cat.type === 'despesa') expenseCats.push(cat);
      else {
        const subs = subCategories(cat.id);
        const total = Object.values(sumForIds([cat.id, ...subs.map((s) => s.id)])).reduce((s, v) => s + v, 0);
        if (total >= 0) ambosIncome.push(cat); else ambosExpense.push(cat);
      }
    }
    // Sort by total magnitude descending within each section (largest to smallest)
    const totalOf = (cat: Category) => {
      const subs = subCategories(cat.id);
      return Math.abs(Object.values(sumForIds([cat.id, ...subs.map((s) => s.id)])).reduce((s, v) => s + v, 0));
    };
    const combinedIncome = [...incomeCats, ...ambosIncome].sort((a, b) => totalOf(b) - totalOf(a));
    const combinedExpense = [...expenseCats, ...ambosExpense].sort((a, b) => totalOf(b) - totalOf(a));
    return { incomeCats: combinedIncome, expenseCats: combinedExpense };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootCategories, subCategories, periods, monthlyByCat]);

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const cat of [...incomeCats, ...expenseCats]) if (subCategories(cat.id).length > 0) all.add(cat.id);
    setExpandedCats(all);
  }

  const fileSuffix = `${startPeriod}_${numPeriods}${interval === 'mensal' ? 'm' : 'a'}`;

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const header = ['Categoria', ...periods.map(periodLabel), 'Media', 'Total'];
    const rows: (string | number)[][] = [header];

    const buildRows = (cats: Category[], sectionLabel: string, sectionTotalsMap: Record<string, number>) => {
      const sVals = periods.map((p) => sectionTotalsMap[p] ?? 0);
      rows.push([sectionLabel, ...sVals, avg(sVals), sVals.reduce((s, v) => s + v, 0)]);
      for (const cat of cats) {
        const subs = subCategories(cat.id);
        const allIds = [cat.id, ...subs.map((s) => s.id)];
        const catTotals = sumForIds(allIds);
        const vals = periods.map((p) => catTotals[p] ?? 0);
        const catTotal = vals.reduce((s, v) => s + v, 0);
        if (catTotal === 0) continue;
        rows.push([`  ${cat.name}`, ...vals, avg(vals), catTotal]);
        for (const sub of subs) {
          const subVals = periods.map((p) => (monthlyByCat[sub.id]?.[p] ?? 0));
          const subTotal = subVals.reduce((s, v) => s + v, 0);
          if (subTotal === 0) continue;
          rows.push([`    ${sub.name}`, ...subVals, avg(subVals), subTotal]);
        }
      }
    };

    buildRows(incomeCats, 'RECEITAS', sectionTotals.receitas);
    buildRows(expenseCats, 'DESPESAS', sectionTotals.despesas);
    const resVals = periods.map((p) => (sectionTotals.receitas[p] ?? 0) + (sectionTotals.despesas[p] ?? 0));
    rows.push(['RESULTADO', ...resVals, avg(resVals), resVals.reduce((s, v) => s + v, 0)]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, ...periods.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Evolucao por Categoria');
    XLSX.writeFile(wb, `evolucao_categorias_${fileSuffix}.xlsx`);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(13);
    doc.text('Evolucao por Categoria', 14, 15);
    doc.setFontSize(8);
    const lastPeriod = periods[periods.length - 1];
    doc.text(`${periodLabel(startPeriod)} — ${lastPeriod ? periodLabel(lastPeriod) : ''}`, 14, 22);

    const body: (string | number)[][] = [];

    const buildRows = (cats: Category[], sectionLabel: string, sectionTotalsMap: Record<string, number>) => {
      const sVals = periods.map((p) => sectionTotalsMap[p] ?? 0);
      body.push([sectionLabel, ...sVals.map(formatBRL), formatBRL(avg(sVals)), formatBRL(sVals.reduce((s, v) => s + v, 0))]);
      for (const cat of cats) {
        const subs = subCategories(cat.id);
        const allIds = [cat.id, ...subs.map((s) => s.id)];
        const catTotals = sumForIds(allIds);
        const vals = periods.map((p) => catTotals[p] ?? 0);
        if (vals.reduce((s, v) => s + v, 0) === 0) continue;
        body.push([`  ${cat.name}`, ...vals.map(formatBRL), formatBRL(avg(vals)), formatBRL(vals.reduce((s, v) => s + v, 0))]);
        for (const sub of subs) {
          const subVals = periods.map((p) => (monthlyByCat[sub.id]?.[p] ?? 0));
          if (subVals.reduce((s, v) => s + v, 0) === 0) continue;
          body.push([`    ${sub.name}`, ...subVals.map(formatBRL), formatBRL(avg(subVals)), formatBRL(subVals.reduce((s, v) => s + v, 0))]);
        }
      }
    };

    buildRows(incomeCats, 'RECEITAS', sectionTotals.receitas);
    buildRows(expenseCats, 'DESPESAS', sectionTotals.despesas);
    const resVals = periods.map((p) => (sectionTotals.receitas[p] ?? 0) + (sectionTotals.despesas[p] ?? 0));
    body.push(['RESULTADO', ...resVals.map(formatBRL), formatBRL(avg(resVals)), formatBRL(resVals.reduce((s, v) => s + v, 0))]);

    autoTable(doc, {
      startY: 27,
      head: [['Categoria', ...periods.map(periodLabel), 'Media', 'Total']],
      body,
      styles: { fontSize: 6, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 40 },
        [periods.length + 1]: { cellWidth: 18 },
        [periods.length + 2]: { cellWidth: 20, fontStyle: 'bold' },
      },
    });

    doc.save(`evolucao_categorias_${fileSuffix}.pdf`);
  }

  if (loading) return <div className="text-accent text-sm animate-pulse">Carregando...</div>;

  const colCount = periods.length + 3;
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
        <div className="ml-auto flex items-center gap-1">
          <button onClick={expandAll} className="px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary bg-bg-card border border-border rounded">
            Expandir
          </button>
          <button onClick={() => setExpandedCats(new Set())} className="px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary bg-bg-card border border-border rounded">
            Recolher
          </button>
          <span className="w-px h-4 bg-border mx-1 hidden sm:block" />
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent"
            title="Exportar Excel"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent"
            title="Exportar PDF"
          >
            <Download size={13} /> PDF
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg border border-border max-h-[calc(100vh-220px)]">
        <table className="text-xs border-collapse w-full">
          <thead className="sticky top-0 z-30">
            <tr className="bg-bg-secondary border-b border-border text-[11px] text-text-secondary uppercase tracking-wider">
              <th className="px-2 py-1.5 text-left sticky left-0 bg-bg-secondary z-40 min-w-[200px]">Categoria</th>
              {periods.map((p) => (
                <th key={p} className="px-2 py-1.5 text-right min-w-[100px] whitespace-nowrap bg-bg-secondary">{periodLabel(p)}</th>
              ))}
              <th className="px-2 py-1.5 text-right min-w-[100px] bg-bg-secondary/80">Media</th>
              <th className="px-2 py-1.5 text-right min-w-[110px] bg-bg-secondary/90">Total</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeaderRow label="Receitas" months={periods} monthTotals={sectionTotals.receitas} colCount={colCount} colorClass="text-accent-green" />

            {incomeCats.map((cat) => {
              const subs = subCategories(cat.id);
              const catTotals = sumForIds([cat.id, ...subs.map((s) => s.id)]);
              if (Object.values(catTotals).reduce((s, v) => s + v, 0) === 0) return null;
              const isExpanded = expandedCats.has(cat.id);
              // Sort subs by magnitude desc for receitas (largest first)
              const sortedSubs = [...subs].sort((a, b) => {
                const ta = Object.values(sumForIds([a.id])).reduce((s, v) => s + v, 0);
                const tb = Object.values(sumForIds([b.id])).reduce((s, v) => s + v, 0);
                return Math.abs(tb) - Math.abs(ta);
              });
              return [
                <CatRow key={cat.id} category={cat} label={cat.name} icon={cat.icon} color={cat.color} indent={1} monthTotals={catTotals} months={periods} isExpanded={isExpanded} hasChildren={subs.length > 0} onToggle={subs.length > 0 ? () => toggleCat(cat.id) : undefined} sectionTotals={sectionTotals.receitas} rowClassName="bg-bg-card" heatmapKind="income" />,
                ...(isExpanded ? sortedSubs.filter((sub) => Object.values(sumForIds([sub.id])).some((v) => v !== 0)).map((sub) => (
                  <CatRow key={sub.id} category={sub} label={sub.name} icon={sub.icon} color={sub.color} indent={2} monthTotals={sumForIds([sub.id])} months={periods} hasChildren={false} sectionTotals={sectionTotals.receitas} rowClassName="bg-bg-primary/40" heatmapKind="income" />
                )) : []),
              ];
            })}

            <SectionHeaderRow label="Despesas" months={periods} monthTotals={sectionTotals.despesas} colCount={colCount} colorClass="text-accent-red" />

            {expenseCats.map((cat) => {
              const subs = subCategories(cat.id);
              const catTotals = sumForIds([cat.id, ...subs.map((s) => s.id)]);
              if (Object.values(catTotals).reduce((s, v) => s + v, 0) === 0) return null;
              const isExpanded = expandedCats.has(cat.id);
              // Sort subs by magnitude desc (largest first)
              const sortedSubs = [...subs].sort((a, b) => {
                const ta = Object.values(sumForIds([a.id])).reduce((s, v) => s + v, 0);
                const tb = Object.values(sumForIds([b.id])).reduce((s, v) => s + v, 0);
                return Math.abs(tb) - Math.abs(ta);
              });
              return [
                <CatRow key={cat.id} category={cat} label={cat.name} icon={cat.icon} color={cat.color} indent={1} monthTotals={catTotals} months={periods} isExpanded={isExpanded} hasChildren={subs.length > 0} onToggle={subs.length > 0 ? () => toggleCat(cat.id) : undefined} sectionTotals={sectionTotals.despesas} rowClassName="bg-bg-card" heatmapKind="expense" />,
                ...(isExpanded ? sortedSubs.filter((sub) => Object.values(sumForIds([sub.id])).some((v) => v !== 0)).map((sub) => (
                  <CatRow key={sub.id} category={sub} label={sub.name} icon={sub.icon} color={sub.color} indent={2} monthTotals={sumForIds([sub.id])} months={periods} hasChildren={false} sectionTotals={sectionTotals.despesas} rowClassName="bg-bg-primary/40" heatmapKind="expense" />
                )) : []),
              ];
            })}

            <ResultadoRow months={periods} receitas={sectionTotals.receitas} despesas={sectionTotals.despesas} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
