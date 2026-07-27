import { useMemo } from 'react';
import { CategoryIcon } from '../shared/CategoryIcon';
import { CHART_COLORS, OTHER_COLOR } from '../../lib/chartTheme';
import {
  formatBRL,
  getMonthYear,
  getMonthYearOffset,
  countsInTotals,
  getExcludedFromTotalsIds,
  isExpenseAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';

const TOP_N = 5;
const WINDOW_MONTHS = 12;
const UNCATEGORIZED_ID = '__uncategorized';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
}

interface MixSlice {
  id: string;
  name: string;
  icon: string;
  color: string;
  total: number;
  share: number;
  perMonth: number;
}

function periodLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' })
      .format(date)
      .replace('.', '');
  return `${fmt(new Date(y, m - WINDOW_MONTHS, 1))} a ${fmt(new Date(y, m - 1, 1))}`;
}

/**
 * Composição estrutural da despesa: peso de cada categoria na MÉDIA dos últimos
 * 12 meses. Complementa o donut do mês, que oscila com sazonalidade e compras
 * pontuais — aqui a leitura é "moradia é 25% do meu custo", não "gastei X em
 * julho".
 *
 * Barras horizontais + faixa empilhada em vez de donut: com mais de 6 fatias o
 * donut fica ilegível (docs/MELHORIAS-VISUAIS.md §4).
 */
export function CategoryMix12mChart({ transactions, categories, monthYear }: Props) {
  const { slices, total, monthsWithData } = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);
    // Janela de 12 meses terminando no mês selecionado (inclusive).
    const windowMonths = new Set<string>();
    for (let i = 0; i < WINDOW_MONTHS; i++) {
      windowMonths.add(getMonthYearOffset(monthYear, -i));
    }

    const byParent = new Map<string, number>();
    const activeMonths = new Set<string>();
    let sum = 0;

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      if (!isExpenseAmount(t)) continue;
      const mk = getMonthYear(accountingDate(t));
      if (!windowMonths.has(mk)) continue;

      const catId = t.categoryId || UNCATEGORIZED_ID;
      const cat = categories.find((c) => c.id === catId);
      // Subcategoria rola para o pai — a leitura estrutural é por categoria-mãe.
      const parentId = cat?.parentId || catId;
      // Despesa como positivo; reembolso (positivo) reduz o gasto.
      const amt = -t.amount;

      byParent.set(parentId, (byParent.get(parentId) || 0) + amt);
      activeMonths.add(mk);
      sum += amt;
    }

    if (sum <= 0) {
      return { slices: [] as MixSlice[], total: 0, monthsWithData: 0 };
    }

    const months = activeMonths.size || 1;
    const ranked = Array.from(byParent.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    const result: MixSlice[] = ranked.slice(0, TOP_N).map(([id, value], i) => {
      const cat = categories.find((c) => c.id === id);
      return {
        id,
        name: cat?.name || 'Sem categoria',
        icon: cat?.icon || 'tag',
        // Cor própria da categoria — mantém a mesma identidade do donut do mês
        // logo acima; a paleta do tema só entra como reserva.
        color: cat?.color || CHART_COLORS[i % CHART_COLORS.length],
        total: value,
        share: (value / sum) * 100,
        perMonth: value / months,
      };
    });

    const restTotal = ranked.slice(TOP_N).reduce((s, [, v]) => s + v, 0);
    if (restTotal > 0) {
      result.push({
        id: '__outros',
        name: `Outros (${ranked.length - TOP_N})`,
        icon: 'tag',
        color: OTHER_COLOR,
        total: restTotal,
        share: (restTotal / sum) * 100,
        perMonth: restTotal / months,
      });
    }

    return { slices: result, total: sum, monthsWithData: months };
  }, [transactions, categories, monthYear]);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div>
        <h3 className="text-title font-semibold text-text-primary">Composição do gasto · 12 meses</h3>
        <p className="text-caption text-ink-3 mt-0.5">
          {periodLabel(monthYear)}
          {monthsWithData > 0 && (
            <> · {formatBRL(total / monthsWithData)}/mês em {monthsWithData}{' '}
            {monthsWithData === 1 ? 'mês' : 'meses'}</>
          )}
        </p>
      </div>

      {slices.length === 0 ? (
        <p className="text-caption text-ink-3 text-center py-6">
          Sem despesas nos últimos 12 meses.
        </p>
      ) : (
        <>
          {/* Faixa 100% empilhada — a leitura de composição num relance */}
          <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
            {slices.map((s) => (
              <div
                key={s.id}
                style={{ width: `${s.share}%`, backgroundColor: s.color }}
                title={`${s.name}: ${s.share.toFixed(1).replace('.', ',')}%`}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            {slices.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                title={`${formatBRL(s.total)} em ${monthsWithData} ${monthsWithData === 1 ? 'mês' : 'meses'}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <CategoryIcon
                    icon={s.icon}
                    size={13}
                    className="flex-shrink-0"
                    style={{ color: s.color }}
                  />
                  <span className="text-body text-text-primary truncate">{s.name}</span>
                </div>
                <div className="flex items-baseline gap-2 tnum flex-shrink-0">
                  <span className="text-body font-semibold text-text-primary">
                    {s.share.toFixed(1).replace('.', ',')}%
                  </span>
                  <span className="text-caption text-ink-3 w-[104px] text-right">
                    {formatBRL(s.perMonth)}/mês
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
