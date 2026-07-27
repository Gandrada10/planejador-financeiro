import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { formatBRL, formatSignedBRL, countsInTotals, getExcludedFromTotalsIds, isIncomeAmount, accountingDate } from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import { ColumnHeader, YoyRow } from './YoyRow';
import {
  YOY_ROW_GRID,
  YOY_PREV_CELL,
  YOY_DELTA_CELL,
  resolveTrend,
  toneForDelta,
  type YoyItem,
  type YoySubItem,
  type GroupTotal,
} from './yoyShared';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
  periodLabel: string;
}

const UNCATEGORIZED_ID = '__uncategorized';
const UNCATEGORIZED_NAME = 'Sem categoria';
const UNCATEGORIZED_COLOR = '#737373';

const RESULTADO_TOP_N = 5;

type GroupKey = 'expenses' | 'income' | 'resultado';

function computePct(curr: number, prev: number, absBase = false): number | null {
  if (prev === 0) return null;
  const base = absBase ? Math.abs(prev) : prev;
  return ((curr - prev) / base) * 100;
}

export function YoyDeviationPanel({
  transactions,
  categories,
  monthYear,
  isMonthInProgress,
  periodLabel,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<GroupKey | null>(null);

  const data = useMemo(() => {
    // Transferências ficam fora da comparação ano-a-ano (totais e por categoria).
    const excludedIds = getExcludedFromTotalsIds(categories);
    const [y, m] = monthYear.split('-').map(Number);
    const prevYear = y - 1;

    type Bucket = {
      curr: number;
      prev: number;
      subs: Map<string, { curr: number; prev: number }>;
    };

    const expMap = new Map<string, Bucket>();
    const incMap = new Map<string, Bucket>();

    let totalCurrExp = 0;
    let totalPrevExp = 0;
    let totalCurrInc = 0;
    let totalPrevInc = 0;
    let hasPrev = false;

    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const ad = accountingDate(t);
      const ty = ad.getFullYear();
      const tm = ad.getMonth() + 1;
      if (tm > m) continue;
      const isCurr = ty === y;
      const isPrev = ty === prevYear;
      if (!isCurr && !isPrev) continue;
      if (isPrev) hasPrev = true;

      const isIncome = isIncomeAmount(t);
      // Reembolso (positivo, não-receita) entra no bucket de despesa como
      // valor NEGATIVO, reduzindo o gasto (contra-despesa).
      const amt = isIncome ? t.amount : -t.amount;
      const catId = t.categoryId || UNCATEGORIZED_ID;
      const cat = categories.find((c) => c.id === catId);
      const parentId = cat?.parentId || catId;
      const targetMap = isIncome ? incMap : expMap;

      if (!targetMap.has(parentId)) {
        targetMap.set(parentId, { curr: 0, prev: 0, subs: new Map() });
      }
      const bucket = targetMap.get(parentId)!;
      if (isCurr) bucket.curr += amt;
      else bucket.prev += amt;

      if (cat?.parentId) {
        if (!bucket.subs.has(catId)) {
          bucket.subs.set(catId, { curr: 0, prev: 0 });
        }
        const sub = bucket.subs.get(catId)!;
        if (isCurr) sub.curr += amt;
        else sub.prev += amt;
      }

      if (isIncome) {
        if (isCurr) totalCurrInc += amt;
        else totalPrevInc += amt;
      } else {
        if (isCurr) totalCurrExp += amt;
        else totalPrevExp += amt;
      }
    }

    function resolveCategoryMeta(id: string): { name: string; icon: string; color: string } {
      if (id === UNCATEGORIZED_ID) {
        return { name: UNCATEGORIZED_NAME, icon: 'tag', color: UNCATEGORIZED_COLOR };
      }
      const c = categories.find((cc) => cc.id === id);
      return {
        name: c?.name || UNCATEGORIZED_NAME,
        icon: c?.icon || 'tag',
        color: c?.color || UNCATEGORIZED_COLOR,
      };
    }

    function buildItems(map: Map<string, Bucket>): YoyItem[] {
      const items: YoyItem[] = [];
      for (const [parentId, bucket] of map.entries()) {
        if (bucket.curr === 0 && bucket.prev === 0) continue;
        const meta = resolveCategoryMeta(parentId);
        const varianceAbs = bucket.curr - bucket.prev;
        const subs: YoySubItem[] = [];
        for (const [subId, subVals] of bucket.subs.entries()) {
          if (subVals.curr === 0 && subVals.prev === 0) continue;
          const subMeta = resolveCategoryMeta(subId);
          subs.push({
            id: subId,
            name: subMeta.name,
            icon: subMeta.icon,
            color: subMeta.color,
            curr: subVals.curr,
            prev: subVals.prev,
            varianceAbs: subVals.curr - subVals.prev,
            pct: computePct(subVals.curr, subVals.prev),
          });
        }
        subs.sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs));
        items.push({
          id: parentId,
          name: meta.name,
          icon: meta.icon,
          color: meta.color,
          curr: bucket.curr,
          prev: bucket.prev,
          varianceAbs,
          pct: computePct(bucket.curr, bucket.prev),
          subs,
        });
      }
      items.sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs));
      return items;
    }

    const expenseItems = buildItems(expMap);
    const incomeItems = buildItems(incMap);

    // Build resultado lists (impact on resultado: +varianceAbs for income, -varianceAbs for expenses)
    const resultadoHelping: YoyItem[] = [];
    const resultadoHurting: YoyItem[] = [];

    function pushWithImpact(item: YoyItem, sign: 1 | -1) {
      const resultadoImpact = sign * item.varianceAbs;
      if (Math.abs(resultadoImpact) < 1) return;
      const subs = item.subs
        .map((s) => ({ ...s, resultadoImpact: sign * s.varianceAbs }))
        .filter((s) => Math.abs(s.resultadoImpact!) >= 1)
        .sort((a, b) => Math.abs(b.resultadoImpact!) - Math.abs(a.resultadoImpact!));
      const entry: YoyItem = { ...item, resultadoImpact, subs };
      if (resultadoImpact > 0) resultadoHelping.push(entry);
      else resultadoHurting.push(entry);
    }

    for (const it of incomeItems) pushWithImpact(it, 1);
    for (const it of expenseItems) pushWithImpact(it, -1);

    resultadoHelping.sort((a, b) => (b.resultadoImpact || 0) - (a.resultadoImpact || 0));
    resultadoHurting.sort((a, b) => (a.resultadoImpact || 0) - (b.resultadoImpact || 0));

    const currBalance = totalCurrInc - totalCurrExp;
    const prevBalance = totalPrevInc - totalPrevExp;

    // Resultado NÃO usa variação percentual: base negativa que cruza o zero
    // produz números sem leitura humana (o famoso "-151,3%"). No lugar, a
    // variação da TAXA DE POUPANÇA (resultado ÷ receitas) em pontos
    // percentuais — estável a troca de sinal.
    const currRate = totalCurrInc > 0 ? currBalance / totalCurrInc : null;
    const prevRate = totalPrevInc > 0 ? prevBalance / totalPrevInc : null;
    const savingsRatePp =
      currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null;

    const totals: Record<GroupKey, GroupTotal> = {
      expenses: {
        curr: totalCurrExp,
        prev: totalPrevExp,
        varianceAbs: totalCurrExp - totalPrevExp,
        pct: computePct(totalCurrExp, totalPrevExp),
      },
      income: {
        curr: totalCurrInc,
        prev: totalPrevInc,
        varianceAbs: totalCurrInc - totalPrevInc,
        pct: computePct(totalCurrInc, totalPrevInc),
      },
      resultado: {
        curr: currBalance,
        prev: prevBalance,
        varianceAbs: currBalance - prevBalance,
        pct: computePct(currBalance, prevBalance, true),
        savingsRatePp,
      },
    };

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
      new Date(y, m - 1, 1),
    );

    return {
      prevYear,
      hasPrev,
      totals,
      expenseItems,
      incomeItems,
      resultadoHelping,
      resultadoHurting,
      monthName,
    };
  }, [transactions, categories, monthYear]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSummaryClick(group: GroupKey) {
    setActiveGroup((prev) => (prev === group ? null : group));
  }

  const currentYear = monthYear.split('-')[0];

  const canExpand: Record<GroupKey, boolean> = {
    expenses: data.hasPrev && data.expenseItems.length > 0,
    income: data.hasPrev && data.incomeItems.length > 0,
    resultado:
      data.hasPrev && (data.resultadoHelping.length > 0 || data.resultadoHurting.length > 0),
  };

  const rows: Array<{ key: GroupKey; label: string; higherIsBetter: boolean }> = [
    { key: 'expenses', label: 'Despesas', higherIsBetter: false },
    { key: 'income', label: 'Receitas', higherIsBetter: true },
    { key: 'resultado', label: 'Resultado', higherIsBetter: true },
  ];

  return (
    <div className="@container bg-bg-card border border-border rounded-card">
      <div className="px-4 py-2.5 border-b border-border">
        <p className="text-title font-semibold text-text-primary">Desvio YoY · acumulado do ano</p>
        <p className="text-caption text-ink-3 mt-0.5">
          {periodLabel} {currentYear} vs {periodLabel} {data.prevYear}
          {isMonthInProgress && (
            <span
              className="text-accent inline-flex items-center gap-1 ml-1"
              title="O mês selecionado ainda está em andamento; os valores podem mudar até o fechamento."
            >
              · <AlertTriangle size={11} className="flex-shrink-0" />
              {data.monthName} em andamento
            </span>
          )}
        </p>
      </div>

      <ColumnHeader />

      <div className="divide-y divide-border/50">
        {rows.map((row) => (
          <div key={row.key}>
            <SummaryRow
              label={row.label}
              total={data.totals[row.key]}
              higherIsBetter={row.higherIsBetter}
              hasPrev={data.hasPrev}
              prevYear={data.prevYear}
              isSavingsRate={row.key === 'resultado'}
              isActive={activeGroup === row.key}
              canExpand={canExpand[row.key]}
              onClick={() => handleSummaryClick(row.key)}
            />

            {activeGroup === 'expenses' && row.key === 'expenses' && canExpand.expenses && (
              <GroupDrilldown
                items={data.expenseItems}
                higherIsBetter={false}
                hasPrev={data.hasPrev}
                prevYear={data.prevYear}
                expanded={expanded}
                toggle={toggle}
                catKeyPrefix="cat:exp:"
                showAllKey="showAll:group:expenses"
              />
            )}
            {activeGroup === 'income' && row.key === 'income' && canExpand.income && (
              <GroupDrilldown
                items={data.incomeItems}
                higherIsBetter
                hasPrev={data.hasPrev}
                prevYear={data.prevYear}
                expanded={expanded}
                toggle={toggle}
                catKeyPrefix="cat:inc:"
                showAllKey="showAll:group:income"
              />
            )}
            {activeGroup === 'resultado' && row.key === 'resultado' && canExpand.resultado && (
              <ResultadoDrilldown
                helping={data.resultadoHelping}
                hurting={data.resultadoHurting}
                prevYear={data.prevYear}
                expanded={expanded}
                toggle={toggle}
              />
            )}
          </div>
        ))}
      </div>

      {!data.hasPrev && (
        <p className="px-4 py-2 text-caption text-ink-3 border-t border-border">
          Sem lançamentos em {data.prevYear} para comparar.
        </p>
      )}
    </div>
  );
}

// ---------- Linha-resumo ----------

interface SummaryRowProps {
  label: string;
  total: GroupTotal;
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  isSavingsRate: boolean;
  isActive: boolean;
  canExpand: boolean;
  onClick: () => void;
}

function SummaryRow({
  label,
  total,
  higherIsBetter,
  hasPrev,
  prevYear,
  isSavingsRate,
  isActive,
  canExpand,
  onClick,
}: SummaryRowProps) {
  // No Resultado a coluna de % vira Δ da taxa de poupança (p.p.); o percentual
  // clássico sobrevive só no title, para quem quiser conferir.
  const trend = isSavingsRate
    ? resolveTrend(total.savingsRatePp ?? null, true, { hasPrev, unit: 'pp' })
    : resolveTrend(total.pct, higherIsBetter, {
        hasPrev,
        isNew: total.prev === 0 && total.curr !== 0,
      });

  const pctTitle =
    isSavingsRate && total.pct !== null
      ? `Variação percentual sobre base absoluta: ${total.pct.toFixed(1).replace('.', ',')}%`
      : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canExpand}
      aria-expanded={isActive}
      className={`w-full text-left ${YOY_ROW_GRID} px-4 py-2 transition-colors ${
        isActive ? 'bg-elevated' : ''
      } ${canExpand ? 'hover:bg-elevated/60 cursor-pointer' : 'cursor-default'}`}
    >
      {canExpand ? (
        isActive ? (
          <ChevronDown size={12} className="text-text-secondary" />
        ) : (
          <ChevronRight size={12} className="text-text-secondary" />
        )
      ) : (
        <span />
      )}

      <span className="text-body font-semibold text-text-primary truncate">{label}</span>

      <span
        className="text-body tnum font-semibold text-text-primary text-right"
        title={`${prevYear}: ${hasPrev ? formatBRL(total.prev) : '—'}${
          hasPrev ? ` · Δ ${formatSignedBRL(total.varianceAbs)}` : ''
        }`}
      >
        {formatBRL(total.curr)}
      </span>

      <span className={`${YOY_PREV_CELL} text-body tnum text-text-secondary text-right`}>
        {hasPrev ? formatBRL(total.prev) : '—'}
      </span>

      <span
        className={`${YOY_DELTA_CELL} text-body tnum font-semibold text-right ${
          hasPrev ? toneForDelta(total.varianceAbs, higherIsBetter) : 'text-ink-3'
        }`}
      >
        {hasPrev ? formatSignedBRL(total.varianceAbs) : '—'}
      </span>

      <span
        className={`flex items-center justify-end gap-1 text-caption tnum ${trend.color}`}
        title={pctTitle}
      >
        {trend.hasValue && <trend.Icon size={11} className="flex-shrink-0" />}
        {trend.text}
      </span>
    </button>
  );
}

// ---------- Drill-down ----------

interface GroupDrilldownProps {
  items: YoyItem[];
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  catKeyPrefix: string;
  showAllKey: string;
}

function GroupDrilldown({
  items,
  higherIsBetter,
  hasPrev,
  prevYear,
  expanded,
  toggle,
  catKeyPrefix,
  showAllKey,
}: GroupDrilldownProps) {
  const showAll = expanded.has(showAllKey);
  const visibleItems = showAll ? items : items.slice(0, RESULTADO_TOP_N);
  const extraCount = Math.max(0, items.length - RESULTADO_TOP_N);

  return (
    <div className="bg-bg-secondary/40 border-t border-border">
      <div className="divide-y divide-border/40">
        {visibleItems.map((item) => {
          const rowKey = `${catKeyPrefix}${item.id}`;
          const isOpen = expanded.has(rowKey);
          const hasSubs = item.subs.length > 0;
          return (
            <div key={item.id}>
              <YoyRow
                item={item}
                higherIsBetter={higherIsBetter}
                hasPrev={hasPrev}
                prevYear={prevYear}
                hasSubs={hasSubs}
                open={isOpen}
                onToggle={() => toggle(rowKey)}
              />
              {isOpen && hasSubs && (
                <div className="bg-bg-secondary/60 divide-y divide-border/30">
                  {item.subs.map((sub) => (
                    <YoyRow
                      key={sub.id}
                      item={sub}
                      depth={1}
                      higherIsBetter={higherIsBetter}
                      hasPrev={hasPrev}
                      prevYear={prevYear}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {extraCount > 0 && (
        <ShowMoreButton
          expanded={showAll}
          extraCount={extraCount}
          onClick={() => toggle(showAllKey)}
        />
      )}
    </div>
  );
}

interface ResultadoDrilldownProps {
  helping: YoyItem[];
  hurting: YoyItem[];
  prevYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
}

function ResultadoDrilldown({
  helping,
  hurting,
  prevYear,
  expanded,
  toggle,
}: ResultadoDrilldownProps) {
  const sections: Array<{
    items: YoyItem[];
    title: string;
    tone: string;
    showAllKey: string;
    rowPrefix: string;
  }> = [
    {
      items: helping,
      title: 'Ajudando o resultado',
      tone: 'text-positive',
      showAllKey: 'showAll:resultado:helping',
      rowPrefix: 'cat:res:h:',
    },
    {
      items: hurting,
      title: 'Atrapalhando o resultado',
      tone: 'text-negative',
      showAllKey: 'showAll:resultado:hurting',
      rowPrefix: 'cat:res:x:',
    },
  ];

  return (
    <div className="bg-bg-secondary/40 border-t border-border">
      {sections.map((section, idx) => {
        if (section.items.length === 0) return null;
        const showAll = expanded.has(section.showAllKey);
        const visible = showAll ? section.items : section.items.slice(0, RESULTADO_TOP_N);
        const extraCount = Math.max(0, section.items.length - RESULTADO_TOP_N);

        return (
          <div key={section.showAllKey} className={idx > 0 ? 'border-t border-border' : ''}>
            <p
              className={`px-4 pt-2 pb-1 text-caption font-semibold uppercase tracking-wider ${section.tone}`}
            >
              {section.title}
            </p>
            <ColumnHeader deltaLabel="Impacto" />
            <div className="divide-y divide-border/40">
              {visible.map((item) => {
                const rowKey = `${section.rowPrefix}${item.id}`;
                const isOpen = expanded.has(rowKey);
                const hasSubs = item.subs.length > 0;
                return (
                  <div key={item.id}>
                    <YoyRow
                      item={item}
                      mode="impact"
                      higherIsBetter
                      hasPrev
                      prevYear={prevYear}
                      hasSubs={hasSubs}
                      open={isOpen}
                      onToggle={() => toggle(rowKey)}
                    />
                    {isOpen && hasSubs && (
                      <div className="bg-bg-secondary/60 divide-y divide-border/30">
                        {item.subs.map((sub) => (
                          <YoyRow
                            key={sub.id}
                            item={sub}
                            depth={1}
                            mode="impact"
                            higherIsBetter
                            hasPrev
                            prevYear={prevYear}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {extraCount > 0 && (
              <ShowMoreButton
                expanded={showAll}
                extraCount={extraCount}
                onClick={() => toggle(section.showAllKey)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShowMoreButton({
  expanded,
  extraCount,
  onClick,
}: {
  expanded: boolean;
  extraCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-1.5 text-caption font-medium text-text-secondary hover:text-text-primary hover:bg-elevated/60 text-left flex items-center gap-1 border-t border-border/40"
    >
      {expanded ? (
        <>
          <ChevronDown size={12} />
          Ver menos
        </>
      ) : (
        <>
          <ChevronRight size={12} />
          Ver mais {extraCount} {extraCount === 1 ? 'item' : 'itens'}
        </>
      )}
    </button>
  );
}
