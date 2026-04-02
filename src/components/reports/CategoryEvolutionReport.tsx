import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL, getMonthYear, getMonthYearOffset } from '../../lib/utils';
import type { Category } from '../../types';

const PERIOD_OPTIONS = [3, 6, 12, 24];

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
  sectionTotals?: Record<string, number>; // to compute percentage
  rowClassName?: string;
}

function CatRow({ label, icon, color, indent, monthTotals, months, isExpanded, hasChildren, onToggle, sectionTotals, rowClassName }: CatRowProps) {
  const values = months.map((m) => monthTotals[m] ?? 0);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);

  return (
    <tr className={`border-b border-border/20 ${rowClassName || ''} ${onToggle ? 'cursor-pointer hover:bg-bg-secondary/30 transition-colors' : ''}`} onClick={onToggle}>
      {/* Label column */}
      <td className="p-0 sticky left-0 z-10 bg-inherit">
        <div
          className="flex items-center gap-1.5 px-3 py-2 whitespace-nowrap"
          style={{ paddingLeft: `${12 + indent * 20}px` }}
        >
          {hasChildren !== undefined && (
            <span className="w-3 flex-shrink-0 text-text-secondary">
              {hasChildren
                ? isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
                : <span className="w-3" />}
            </span>
          )}
          {icon && (
            <span style={{ color: color }} className="flex-shrink-0 leading-none">
              <CategoryIcon icon={icon} size={13} />
            </span>
          )}
          <span className="text-xs" style={{ color: color }}>
            {label}
          </span>
        </div>
      </td>

      {/* Month columns */}
      {months.map((m) => {
        const val = monthTotals[m] ?? 0;
        const sectionTotal = sectionTotals?.[m] ?? 0;
        const pct = sectionTotal !== 0 ? (Math.abs(val) / Math.abs(sectionTotal)) * 100 : 0;
        return (
          <td key={m} className="p-2 text-right font-mono whitespace-nowrap align-top min-w-[100px]">
            {val !== 0 ? (
              <>
                <div className={`text-xs ${val >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {formatBRL(val)}
                </div>
                {sectionTotals && pct > 0 && (
                  <div className="text-[9px] text-text-secondary">{pct.toFixed(1)}%</div>
                )}
              </>
            ) : (
              <span className="text-[10px] text-text-secondary/40">—</span>
            )}
          </td>
        );
      })}

      {/* Average column */}
      <td className="p-2 text-right font-mono whitespace-nowrap min-w-[100px] bg-bg-secondary/20">
        {average !== 0 ? (
          <span className={`text-xs ${average >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatBRL(average)}
          </span>
        ) : <span className="text-[10px] text-text-secondary/40">—</span>}
      </td>

      {/* Total column */}
      <td className="p-2 text-right font-bold font-mono whitespace-nowrap min-w-[110px] bg-bg-secondary/30">
        {total !== 0 ? (
          <span className={`text-xs ${total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {formatBRL(total)}
          </span>
        ) : <span className="text-[10px] text-text-secondary/40">—</span>}
      </td>
    </tr>
  );
}

export function CategoryEvolutionReport() {
  const { transactions, loading } = useTransactions();
  const { rootCategories, subCategories } = useCategories();

  const [startMonth, setStartMonth] = useState(() => getMonthYearOffset(getMonthYear(), -11));
  const [numMonths, setNumMonths] = useState(12);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Generate months array
  const months = useMemo(
    () => Array.from({ length: numMonths }, (_, i) => getMonthYearOffset(startMonth, i)),
    [startMonth, numMonths]
  );

  // Build per-category, per-month totals
  const monthlyByCat = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const t of transactions) {
      const m = getMonthYear(t.date);
      if (!months.includes(m)) continue;
      const catId = t.categoryId || '__none';
      if (!result[catId]) result[catId] = {};
      result[catId][m] = (result[catId][m] || 0) + t.amount;
    }
    return result;
  }, [transactions, months]);

  // Compute totals for a set of category IDs across months
  function sumForIds(ids: string[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const m of months) {
      result[m] = ids.reduce((s, id) => s + (monthlyByCat[id]?.[m] || 0), 0);
    }
    return result;
  }

  // Section totals (receitas / despesas) for percentage reference
  const sectionTotals = useMemo(() => {
    const receitas: Record<string, number> = {};
    const despesas: Record<string, number> = {};
    for (const m of months) {
      const monthTxs = transactions.filter((t) => getMonthYear(t.date) === m);
      receitas[m] = monthTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      despesas[m] = monthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    }
    return { receitas, despesas };
  }, [transactions, months]);

  // Build category rows for rendering
  const { incomeCats, expenseCats } = useMemo(() => {
    // Separate root categories by type
    const incomeCats: Category[] = [];
    const expenseCats: Category[] = [];
    const ambosIncome: Category[] = [];
    const ambosExpense: Category[] = [];

    for (const cat of rootCategories) {
      if (cat.type === 'receita') incomeCats.push(cat);
      else if (cat.type === 'despesa') expenseCats.push(cat);
      else {
        // 'ambos' - classify by actual transactions
        const subs = subCategories(cat.id);
        const allIds = [cat.id, ...subs.map((s) => s.id)];
        const totals = sumForIds(allIds);
        const total = Object.values(totals).reduce((s, v) => s + v, 0);
        if (total >= 0) ambosIncome.push(cat);
        else ambosExpense.push(cat);
      }
    }

    return {
      incomeCats: [...incomeCats, ...ambosIncome],
      expenseCats: [...expenseCats, ...ambosExpense],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootCategories, subCategories, months, monthlyByCat]);

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const cat of [...incomeCats, ...expenseCats]) {
      const subs = subCategories(cat.id);
      if (subs.length > 0) all.add(cat.id);
    }
    setExpandedCats(all);
  }

  function collapseAll() {
    setExpandedCats(new Set());
  }

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando...</div>;
  }

  const colCount = months.length + 3; // label + months + media + total

  return (
    <div className="space-y-3">
      {/* Period controls */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Inicio</label>
          <input
            type="month"
            value={startMonth}
            onChange={(e) => setStartMonth(e.target.value)}
            className="px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Periodo</label>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setNumMonths(n)}
                className={`px-3 py-2 text-xs rounded border transition-colors ${
                  numMonths === n
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {n}m
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex gap-1">
          <button onClick={expandAll} className="px-2 py-1.5 text-[10px] text-text-secondary hover:text-text-primary bg-bg-secondary border border-border rounded">
            Expandir
          </button>
          <button onClick={collapseAll} className="px-2 py-1.5 text-[10px] text-text-secondary hover:text-text-primary bg-bg-secondary border border-border rounded">
            Recolher
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-bg-secondary border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
              <th className="p-2 text-left sticky left-0 bg-bg-secondary z-20 min-w-[200px]">Categoria</th>
              {months.map((m) => (
                <th key={m} className="p-2 text-right min-w-[100px] whitespace-nowrap">{shortMonthLabel(m)}</th>
              ))}
              <th className="p-2 text-right min-w-[100px] bg-bg-secondary/60">Media</th>
              <th className="p-2 text-right min-w-[110px] bg-bg-secondary/80">Total</th>
            </tr>
          </thead>
          <tbody>
            {/* ── RECEITAS section ── */}
            <SectionHeaderRow label="Receitas" months={months} monthTotals={sectionTotals.receitas} colCount={colCount} colorClass="text-accent-green" />

            {incomeCats.map((cat) => {
              const subs = subCategories(cat.id);
              const allIds = [cat.id, ...subs.map((s) => s.id)];
              const catTotals = sumForIds(allIds);
              const catTotal = Object.values(catTotals).reduce((s, v) => s + v, 0);
              if (catTotal === 0) return null;
              const isExpanded = expandedCats.has(cat.id);

              return [
                <CatRow
                  key={cat.id}
                  category={cat}
                  label={cat.name}
                  icon={cat.icon}
                  color={cat.color}
                  indent={1}
                  monthTotals={catTotals}
                  months={months}
                  isExpanded={isExpanded}
                  hasChildren={subs.length > 0}
                  onToggle={subs.length > 0 ? () => toggleCat(cat.id) : undefined}
                  sectionTotals={sectionTotals.receitas}
                  rowClassName="bg-bg-card"
                />,
                ...(isExpanded ? subs.filter((sub) => {
                  const subTotals = sumForIds([sub.id]);
                  return Object.values(subTotals).some((v) => v !== 0);
                }).map((sub) => (
                  <CatRow
                    key={sub.id}
                    category={sub}
                    label={sub.name}
                    icon={sub.icon}
                    color={sub.color}
                    indent={2}
                    monthTotals={sumForIds([sub.id])}
                    months={months}
                    hasChildren={false}
                    sectionTotals={sectionTotals.receitas}
                    rowClassName="bg-bg-primary/40"
                  />
                )) : []),
              ];
            })}

            {/* ── DESPESAS section ── */}
            <SectionHeaderRow label="Despesas" months={months} monthTotals={sectionTotals.despesas} colCount={colCount} colorClass="text-accent-red" />

            {expenseCats.map((cat) => {
              const subs = subCategories(cat.id);
              const allIds = [cat.id, ...subs.map((s) => s.id)];
              const catTotals = sumForIds(allIds);
              const catTotal = Object.values(catTotals).reduce((s, v) => s + v, 0);
              if (catTotal === 0) return null;
              const isExpanded = expandedCats.has(cat.id);

              return [
                <CatRow
                  key={cat.id}
                  category={cat}
                  label={cat.name}
                  icon={cat.icon}
                  color={cat.color}
                  indent={1}
                  monthTotals={catTotals}
                  months={months}
                  isExpanded={isExpanded}
                  hasChildren={subs.length > 0}
                  onToggle={subs.length > 0 ? () => toggleCat(cat.id) : undefined}
                  sectionTotals={sectionTotals.despesas}
                  rowClassName="bg-bg-card"
                />,
                ...(isExpanded ? subs.filter((sub) => {
                  const subTotals = sumForIds([sub.id]);
                  return Object.values(subTotals).some((v) => v !== 0);
                }).map((sub) => (
                  <CatRow
                    key={sub.id}
                    category={sub}
                    label={sub.name}
                    icon={sub.icon}
                    color={sub.color}
                    indent={2}
                    monthTotals={sumForIds([sub.id])}
                    months={months}
                    hasChildren={false}
                    sectionTotals={sectionTotals.despesas}
                    rowClassName="bg-bg-primary/40"
                  />
                )) : []),
              ];
            })}

            {/* ── RESULTADO row ── */}
            <ResultadoRow months={months} receitas={sectionTotals.receitas} despesas={sectionTotals.despesas} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helper sub-components ──

function SectionHeaderRow({ label, months, monthTotals, colorClass }: {
  label: string;
  months: string[];
  monthTotals: Record<string, number>;
  colCount: number;
  colorClass: string;
}) {
  const values = months.map((m) => monthTotals[m] ?? 0);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);

  return (
    <tr className="bg-bg-secondary/60 border-y border-border">
      <td className="p-2 pl-3 sticky left-0 z-10 bg-bg-secondary/60">
        <span className={`text-xs font-bold uppercase tracking-wider ${colorClass}`}>{label}</span>
      </td>
      {months.map((m) => {
        const val = monthTotals[m] ?? 0;
        return (
          <td key={m} className="p-2 text-right font-bold font-mono whitespace-nowrap">
            {val !== 0 ? (
              <span className={`text-xs ${colorClass}`}>{formatBRL(val)}</span>
            ) : <span className="text-[10px] text-text-secondary/40">—</span>}
          </td>
        );
      })}
      <td className="p-2 text-right font-bold font-mono whitespace-nowrap bg-bg-secondary/20">
        {average !== 0 && <span className={`text-xs ${colorClass}`}>{formatBRL(average)}</span>}
      </td>
      <td className="p-2 text-right font-bold font-mono whitespace-nowrap bg-bg-secondary/40">
        {total !== 0 && <span className={`text-xs ${colorClass}`}>{formatBRL(total)}</span>}
      </td>
    </tr>
  );
}

function ResultadoRow({ months, receitas, despesas }: {
  months: string[];
  receitas: Record<string, number>;
  despesas: Record<string, number>;
}) {
  const resultados: Record<string, number> = {};
  for (const m of months) {
    resultados[m] = (receitas[m] ?? 0) + (despesas[m] ?? 0);
  }
  const values = months.map((m) => resultados[m]);
  const total = values.reduce((s, v) => s + v, 0);
  const average = avg(values);

  return (
    <tr className="bg-bg-secondary/80 border-t-2 border-border">
      <td className="p-2 pl-3 sticky left-0 z-10 bg-bg-secondary/80">
        <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Resultado</span>
      </td>
      {months.map((m) => {
        const val = resultados[m] ?? 0;
        return (
          <td key={m} className="p-2 text-right font-bold font-mono whitespace-nowrap">
            {val !== 0 ? (
              <span className={`text-xs ${val >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(val)}</span>
            ) : <span className="text-[10px] text-text-secondary/40">—</span>}
          </td>
        );
      })}
      <td className="p-2 text-right font-bold font-mono whitespace-nowrap bg-bg-secondary/20">
        {average !== 0 && <span className={`text-xs ${average >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(average)}</span>}
      </td>
      <td className="p-2 text-right font-bold font-mono whitespace-nowrap bg-bg-secondary/40">
        {total !== 0 && <span className={`text-xs ${total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{formatBRL(total)}</span>}
      </td>
    </tr>
  );
}
