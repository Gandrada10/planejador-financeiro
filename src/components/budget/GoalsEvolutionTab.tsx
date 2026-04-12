import { useState, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import {
  getMonthYear,
  getMonthYearOffset,
  getMonthLabel,
} from '../../lib/utils';

interface EvolutionRow {
  label: string;
  type: 'meta' | 'realizado';
  values: number[];
  average: number;
  total: number;
  isHeader?: boolean;
  indent?: boolean;
  color?: string;
}

export function GoalsEvolutionTab() {
  const { transactions, loading: txLoading } = useTransactions();
  const { categories, subCategories } = useCategories();
  const { budgets, loading: budgetLoading, getBudgetsForMonth } = useBudgets();

  const [startMonth, setStartMonth] = useState(() => getMonthYearOffset(getMonthYear(), -5));
  const [periodCount, setPeriodCount] = useState(6);
  const [loaded, setLoaded] = useState(false);

  // Generate month columns
  const months = useMemo(() => {
    const result: string[] = [];
    for (let i = 0; i < periodCount; i++) {
      result.push(getMonthYearOffset(startMonth, i));
    }
    return result;
  }, [startMonth, periodCount]);

  // Short month labels for column headers
  function shortMonthLabel(my: string): string {
    const [y, m] = my.split('-');
    const months = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ];
    return `${months[Number(m) - 1]}/${y.slice(2)}`;
  }

  // Build all evolution rows
  const rows = useMemo(() => {
    if (!loaded) return [];

    const result: EvolutionRow[] = [];

    // For each month: get budgets and actual spending
    const monthData = months.map((my) => {
      const monthBudgets = getBudgetsForMonth(my);
      const monthTx = transactions.filter(
        (t) => getMonthYear(t.date) === my && t.amount < 0
      );

      // Total budget for month
      const totalBudget = monthBudgets.reduce((s, b) => s + b.limitAmount, 0);

      // Total spending for month
      const totalSpending = monthTx.reduce((s, t) => s + Math.abs(t.amount), 0);

      // Per-category data (using budget category IDs)
      const catData = new Map<string, { meta: number; realizado: number }>();

      for (const b of monthBudgets) {
        const cat = categories.find((c) => c.id === b.categoryId);
        if (!cat) continue;

        // For parent categories, aggregate spending from all subs
        const isParent = !cat.parentId;

        let actual = 0;
        if (isParent) {
          // Sum spending in parent + all subs
          actual += monthTx
            .filter((t) => t.categoryId === b.categoryId)
            .reduce((s, t) => s + Math.abs(t.amount), 0);
          for (const sub of subCategories(b.categoryId)) {
            actual += monthTx
              .filter((t) => t.categoryId === sub.id)
              .reduce((s, t) => s + Math.abs(t.amount), 0);
          }
        } else {
          actual = monthTx
            .filter((t) => t.categoryId === b.categoryId)
            .reduce((s, t) => s + Math.abs(t.amount), 0);
        }

        catData.set(b.categoryId, { meta: b.limitAmount, realizado: actual });
      }

      return { totalBudget, totalSpending, catData };
    });

    // --- Despesas total rows ---
    const despesaMetaValues = monthData.map((d) => d.totalBudget);
    const despesaRealizadoValues = monthData.map((d) => d.totalSpending);

    result.push({
      label: 'Despesas',
      type: 'meta',
      values: despesaMetaValues,
      average: avg(despesaMetaValues),
      total: sum(despesaMetaValues),
      isHeader: true,
    });
    result.push({
      label: 'Despesas',
      type: 'realizado',
      values: despesaRealizadoValues,
      average: avg(despesaRealizadoValues),
      total: sum(despesaRealizadoValues),
      isHeader: true,
    });

    // --- Per-category rows ---
    // Collect all unique category IDs across all months
    const allCatIds = new Set<string>();
    for (const md of monthData) {
      for (const catId of md.catData.keys()) {
        allCatIds.add(catId);
      }
    }

    // Group by parent: only show parent-level categories
    const parentCatIds = new Set<string>();
    for (const catId of allCatIds) {
      const cat = categories.find((c) => c.id === catId);
      if (cat && !cat.parentId) {
        parentCatIds.add(catId);
      }
    }

    const sortedParents = Array.from(parentCatIds)
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean)
      .sort((a, b) => a!.name.localeCompare(b!.name));

    for (const cat of sortedParents) {
      if (!cat) continue;
      const metaValues = monthData.map(
        (d) => d.catData.get(cat.id)?.meta || 0
      );
      const realizadoValues = monthData.map(
        (d) => d.catData.get(cat.id)?.realizado || 0
      );

      // Only add if there's data in at least one month
      if (metaValues.some((v) => v > 0) || realizadoValues.some((v) => v > 0)) {
        result.push({
          label: cat.name,
          type: 'meta',
          values: metaValues,
          average: avg(metaValues),
          total: sum(metaValues),
          indent: true,
          color: cat.color,
        });
        result.push({
          label: cat.name,
          type: 'realizado',
          values: realizadoValues,
          average: avg(realizadoValues),
          total: sum(realizadoValues),
          indent: true,
          color: cat.color,
        });
      }
    }

    // --- Resultado (difference) ---
    const resultadoMetaValues = despesaMetaValues.map((v) => -v);
    const resultadoRealizadoValues = despesaRealizadoValues.map((v) => -v);

    result.push({
      label: 'Resultado',
      type: 'meta',
      values: resultadoMetaValues,
      average: avg(resultadoMetaValues),
      total: sum(resultadoMetaValues),
      isHeader: true,
    });
    result.push({
      label: 'Resultado',
      type: 'realizado',
      values: resultadoRealizadoValues,
      average: avg(resultadoRealizadoValues),
      total: sum(resultadoRealizadoValues),
      isHeader: true,
    });

    return result;
  }, [loaded, months, transactions, categories, subCategories, getBudgetsForMonth, budgets]);

  function handleLoad() {
    setLoaded(true);
  }

  // Available start months
  const availableStartMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) set.add(getMonthYear(t.date));
    for (const b of budgets) set.add(b.monthYear);
    set.add(getMonthYear());
    // Add 12 months back
    for (let i = 0; i < 12; i++) {
      set.add(getMonthYearOffset(getMonthYear(), -i));
    }
    return Array.from(set).sort();
  }, [transactions, budgets]);

  if (txLoading || budgetLoading) {
    return (
      <div className="flex items-center gap-2 text-accent text-sm animate-pulse py-8">
        <Loader2 size={16} className="animate-spin" />
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap px-4 py-3 bg-bg-secondary border border-border rounded-lg">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Intervalo:</span>
          <select
            disabled
            className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary"
          >
            <option>Mensal</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Inicio:</span>
          <select
            value={startMonth}
            onChange={(e) => {
              setStartMonth(e.target.value);
              setLoaded(false);
            }}
            className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary capitalize"
          >
            {availableStartMonths.map((m) => (
              <option key={m} value={m} className="capitalize">
                {getMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Periodo:</span>
          <select
            value={periodCount}
            onChange={(e) => {
              setPeriodCount(Number(e.target.value));
              setLoaded(false);
            }}
            className="bg-bg-card border border-border rounded px-2 py-1 text-xs text-text-primary"
          >
            {[3, 6, 9, 12].map((n) => (
              <option key={n} value={n}>
                {n} meses
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleLoad}
          className="px-4 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:bg-accent/90 transition-colors"
        >
          Carregar
        </button>
      </div>

      {/* Evolution table */}
      {!loaded ? (
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-sm">
          Selecione o periodo e clique em "Carregar" para visualizar a evolucao.
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-sm">
          Nenhuma meta definida no periodo selecionado.
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-bg-secondary border-b border-border">
                <th className="text-left px-3 py-2 text-text-secondary font-normal w-32 sticky left-0 bg-bg-secondary z-10" />
                <th className="text-left px-3 py-2 text-text-secondary font-normal w-24 sticky left-32 bg-bg-secondary z-10">
                  Realizado
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="text-right px-3 py-2 text-text-secondary font-normal min-w-[90px]"
                  >
                    {shortMonthLabel(m)}
                  </th>
                ))}
                <th className="text-right px-3 py-2 text-text-secondary font-normal min-w-[90px]">
                  Media
                </th>
                <th className="text-right px-3 py-2 text-text-secondary font-normal min-w-[90px]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isMeta = row.type === 'meta';
                const isFirst = isMeta; // meta row is first of each pair
                const prevRow = idx > 0 ? rows[idx - 1] : null;
                const showSeparator =
                  isFirst &&
                  prevRow &&
                  prevRow.label !== row.label;

                return (
                  <tr
                    key={`${row.label}-${row.type}`}
                    className={`
                      ${showSeparator ? 'border-t border-border' : 'border-t border-border/30'}
                      ${row.isHeader ? 'bg-bg-secondary/30 font-medium' : ''}
                      hover:bg-bg-secondary/20
                    `}
                  >
                    {/* Label (only show on meta row) */}
                    <td
                      className={`px-3 py-2 sticky left-0 bg-bg-card z-10 ${
                        row.isHeader
                          ? 'font-bold text-text-primary'
                          : row.indent
                          ? 'pl-6 text-text-primary'
                          : 'text-text-primary'
                      }`}
                    >
                      {isMeta && (
                        <div className="flex items-center gap-1.5">
                          {row.color && (
                            <div
                              className="w-1.5 h-4 rounded-full flex-shrink-0"
                              style={{ backgroundColor: row.color }}
                            />
                          )}
                          <span>{row.label}</span>
                        </div>
                      )}
                    </td>

                    {/* Meta/Realizado label */}
                    <td className="px-3 py-2 text-text-secondary sticky left-32 bg-bg-card z-10">
                      {isMeta ? (
                        <span className="font-medium">Meta</span>
                      ) : (
                        <span>Realizado</span>
                      )}
                    </td>

                    {/* Monthly values */}
                    {row.values.map((val, i) => (
                      <td
                        key={months[i]}
                        className={`px-3 py-2 text-right font-mono ${
                          isMeta
                            ? 'text-accent-red'
                            : val > 0
                            ? 'text-text-primary'
                            : 'text-text-secondary'
                        }`}
                      >
                        {formatNumber(isMeta ? -Math.abs(val) : -val)}
                      </td>
                    ))}

                    {/* Average */}
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        isMeta ? 'text-accent-red' : 'text-text-primary'
                      }`}
                    >
                      {formatNumber(isMeta ? -Math.abs(row.average) : -row.average)}
                    </td>

                    {/* Total */}
                    <td
                      className={`px-3 py-2 text-right font-mono font-bold ${
                        isMeta ? 'text-accent-red' : 'text-text-primary'
                      }`}
                    >
                      {formatNumber(isMeta ? -Math.abs(row.total) : -row.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}

function avg(arr: number[]): number {
  const nonZero = arr.filter((v) => v !== 0);
  if (nonZero.length === 0) return 0;
  return sum(nonZero) / nonZero.length;
}

function formatNumber(value: number): string {
  if (value === 0) return '0,00';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
