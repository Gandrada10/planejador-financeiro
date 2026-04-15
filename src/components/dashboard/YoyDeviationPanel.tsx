import { useMemo, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatBRL } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
  periodLabel: string;
}

interface YoySubItem {
  id: string;
  name: string;
  icon: string;
  color: string;
  curr: number;
  prev: number;
  varianceAbs: number;
  pct: number | null;
  resultadoImpact?: number;
}

interface YoyItem extends YoySubItem {
  subs: YoySubItem[];
}

interface GroupTotal {
  curr: number;
  prev: number;
  varianceAbs: number;
  pct: number | null;
}

const UNCATEGORIZED_ID = '__uncategorized';
const UNCATEGORIZED_NAME = 'Sem categoria';
const UNCATEGORIZED_COLOR = '#737373';

// Shared grid template: chevron | category | curr | prev | pct+delta (or impact)
const ROW_GRID =
  'grid grid-cols-[12px_minmax(0,_1fr)_92px_92px_112px] items-center gap-2';

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

  const data = useMemo(() => {
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
      const ty = t.date.getFullYear();
      const tm = t.date.getMonth() + 1;
      if (tm > m) continue;
      const isCurr = ty === y;
      const isPrev = ty === prevYear;
      if (!isCurr && !isPrev) continue;
      if (isPrev) hasPrev = true;

      const amt = Math.abs(t.amount);
      const isIncome = t.amount > 0;
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

    const totals: {
      expenses: GroupTotal;
      income: GroupTotal;
      resultado: GroupTotal;
    } = {
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
      },
    };

    return {
      prevYear,
      hasPrev,
      totals,
      expenseItems,
      incomeItems,
      resultadoHelping,
      resultadoHurting,
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

  const currentYear = monthYear.split('-')[0];

  return (
    <div className="bg-bg-card border border-border rounded-lg">
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-bold text-text-primary uppercase tracking-wider">
            Desvio YoY · acumulado do ano
          </p>
          <p className="text-[10px] text-text-secondary mt-0.5">
            {periodLabel} {currentYear} vs {periodLabel} {data.prevYear}
          </p>
        </div>
        {isMonthInProgress && (
          <span
            className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5 flex-shrink-0"
            title="O mês selecionado ainda está em andamento; os valores podem mudar até o fechamento."
          >
            <AlertTriangle size={10} />
            Mês em andamento
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        <GroupSection
          label="Despesas"
          groupKey="group:expenses"
          total={data.totals.expenses}
          items={data.expenseItems}
          higherIsBetter={false}
          hasPrev={data.hasPrev}
          prevYear={data.prevYear}
          expanded={expanded}
          toggle={toggle}
          catKeyPrefix="cat:exp:"
        />
        <GroupSection
          label="Receitas"
          groupKey="group:income"
          total={data.totals.income}
          items={data.incomeItems}
          higherIsBetter={true}
          hasPrev={data.hasPrev}
          prevYear={data.prevYear}
          expanded={expanded}
          toggle={toggle}
          catKeyPrefix="cat:inc:"
        />
        <ResultadoSection
          total={data.totals.resultado}
          helping={data.resultadoHelping}
          hurting={data.resultadoHurting}
          hasPrev={data.hasPrev}
          prevYear={data.prevYear}
          expanded={expanded}
          toggle={toggle}
        />
      </div>
    </div>
  );
}

// ---------- Group sections ----------

interface GroupSectionProps {
  label: string;
  groupKey: string;
  total: GroupTotal;
  items: YoyItem[];
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  catKeyPrefix: string;
}

function GroupSection({
  label,
  groupKey,
  total,
  items,
  higherIsBetter,
  hasPrev,
  prevYear,
  expanded,
  toggle,
  catKeyPrefix,
}: GroupSectionProps) {
  const isOpen = expanded.has(groupKey);
  const canExpand = hasPrev && items.length > 0;
  const showAllKey = `showAll:${groupKey}`;
  const showAll = expanded.has(showAllKey);
  const visibleItems = showAll ? items : items.slice(0, RESULTADO_TOP_N);
  const extraCount = Math.max(0, items.length - RESULTADO_TOP_N);

  return (
    <div>
      <GroupRow
        label={label}
        curr={total.curr}
        prev={total.prev}
        pct={total.pct}
        varianceAbs={total.varianceAbs}
        higherIsBetter={higherIsBetter}
        hasPrev={hasPrev}
        prevYear={prevYear}
        isOpen={isOpen}
        canExpand={canExpand}
        onToggle={() => canExpand && toggle(groupKey)}
      />
      {isOpen && canExpand && (
        <div className="bg-bg-secondary/40 border-t border-border">
          <ColumnHeader />
          <div className="divide-y divide-border/50">
            {visibleItems.map((item) => (
              <CategoryRow
                key={item.id}
                item={item}
                higherIsBetter={higherIsBetter}
                hasPrev={hasPrev}
                expanded={expanded}
                toggle={toggle}
                rowKey={`${catKeyPrefix}${item.id}`}
              />
            ))}
          </div>
          {extraCount > 0 && (
            <ShowMoreButton
              expanded={showAll}
              extraCount={extraCount}
              onClick={() => toggle(showAllKey)}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ResultadoSectionProps {
  total: GroupTotal;
  helping: YoyItem[];
  hurting: YoyItem[];
  hasPrev: boolean;
  prevYear: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
}

const RESULTADO_TOP_N = 5;

function ResultadoSection({
  total,
  helping,
  hurting,
  hasPrev,
  prevYear,
  expanded,
  toggle,
}: ResultadoSectionProps) {
  const isOpen = expanded.has('group:resultado');
  const canExpand = hasPrev && (helping.length > 0 || hurting.length > 0);
  const showAllHelping = expanded.has('showAll:resultado:helping');
  const showAllHurting = expanded.has('showAll:resultado:hurting');

  const helpingVisible = showAllHelping ? helping : helping.slice(0, RESULTADO_TOP_N);
  const hurtingVisible = showAllHurting ? hurting : hurting.slice(0, RESULTADO_TOP_N);
  const helpingExtra = Math.max(0, helping.length - RESULTADO_TOP_N);
  const hurtingExtra = Math.max(0, hurting.length - RESULTADO_TOP_N);

  return (
    <div>
      <GroupRow
        label="Resultado"
        curr={total.curr}
        prev={total.prev}
        pct={total.pct}
        varianceAbs={total.varianceAbs}
        higherIsBetter={true}
        hasPrev={hasPrev}
        prevYear={prevYear}
        isOpen={isOpen}
        canExpand={canExpand}
        onToggle={() => canExpand && toggle('group:resultado')}
        signed
      />
      {isOpen && canExpand && (
        <div className="bg-bg-secondary/40 border-t border-border">
          {helping.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-accent-green">
                Ajudando o resultado
              </div>
              <ColumnHeader showImpactCol />
              <div className="divide-y divide-border/50">
                {helpingVisible.map((item) => (
                  <ResultadoRow
                    key={`h-${item.id}`}
                    item={item}
                    expanded={expanded}
                    toggle={toggle}
                    rowKey={`cat:res:h:${item.id}`}
                  />
                ))}
              </div>
              {helpingExtra > 0 && (
                <ShowMoreButton
                  expanded={showAllHelping}
                  extraCount={helpingExtra}
                  onClick={() => toggle('showAll:resultado:helping')}
                />
              )}
            </>
          )}
          {hurting.length > 0 && (
            <>
              <div
                className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-accent-red ${helping.length > 0 ? 'border-t border-border' : ''}`}
              >
                Atrapalhando o resultado
              </div>
              <ColumnHeader showImpactCol />
              <div className="divide-y divide-border/50">
                {hurtingVisible.map((item) => (
                  <ResultadoRow
                    key={`x-${item.id}`}
                    item={item}
                    expanded={expanded}
                    toggle={toggle}
                    rowKey={`cat:res:x:${item.id}`}
                  />
                ))}
              </div>
              {hurtingExtra > 0 && (
                <ShowMoreButton
                  expanded={showAllHurting}
                  extraCount={hurtingExtra}
                  onClick={() => toggle('showAll:resultado:hurting')}
                />
              )}
            </>
          )}
        </div>
      )}
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
      className="w-full px-4 py-1.5 text-[10px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-secondary/60 text-left flex items-center gap-1 border-t border-border/40"
    >
      {expanded ? (
        <>
          <ChevronDown size={11} />
          Ver menos
        </>
      ) : (
        <>
          <ChevronRight size={11} />
          Ver mais {extraCount} {extraCount === 1 ? 'item' : 'itens'}
        </>
      )}
    </button>
  );
}

// ---------- Rows ----------

interface GroupRowProps {
  label: string;
  curr: number;
  prev: number;
  pct: number | null;
  varianceAbs: number;
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  isOpen: boolean;
  canExpand: boolean;
  onToggle: () => void;
  signed?: boolean;
}

function GroupRow({
  label,
  curr,
  prev,
  pct,
  varianceAbs,
  higherIsBetter,
  hasPrev,
  prevYear,
  isOpen,
  canExpand,
  onToggle,
  signed,
}: GroupRowProps) {
  const { color, Icon, pctText } = resolveTrend(pct, higherIsBetter, hasPrev);
  const fmt = (v: number) => (signed || v < 0 ? formatBRL(v) : formatBRL(Math.abs(v)));
  const deltaText = hasPrev
    ? `${varianceAbs > 0 ? '+' : ''}${formatBRL(varianceAbs)}`
    : '';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canExpand}
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left ${
        canExpand ? 'hover:bg-bg-secondary/40 cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <span>{label}</span>
          {canExpand &&
            (isOpen ? (
              <ChevronDown size={12} className="text-text-secondary" />
            ) : (
              <ChevronRight size={12} className="text-text-secondary" />
            ))}
        </p>
        <p className="text-[10px] text-text-secondary tabular-nums mt-0.5">
          {fmt(curr)}
          <span className="text-text-secondary/60">
            {' '}
            · {prevYear}: {hasPrev ? fmt(prev) : '—'}
          </span>
        </p>
      </div>
      <div className={`flex items-center gap-2 flex-shrink-0 tabular-nums ${color}`}>
        <div className="flex items-center gap-1 text-xs font-bold">
          <Icon size={12} />
          <span>{pctText}</span>
        </div>
        {deltaText && (
          <span className="text-[11px] font-medium opacity-80 border-l border-current/20 pl-2">
            {deltaText}
          </span>
        )}
      </div>
    </button>
  );
}

interface CategoryRowProps {
  item: YoyItem;
  higherIsBetter: boolean;
  hasPrev: boolean;
  expanded: Set<string>;
  toggle: (key: string) => void;
  rowKey: string;
}

function CategoryRow({
  item,
  higherIsBetter,
  hasPrev,
  expanded,
  toggle,
  rowKey,
}: CategoryRowProps) {
  const isOpen = expanded.has(rowKey);
  const hasSubs = item.subs.length > 0;
  const { color, Icon, pctText } = resolveTrend(item.pct, higherIsBetter, hasPrev);
  const deltaText = `${item.varianceAbs > 0 ? '+' : ''}${formatBRL(item.varianceAbs)}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasSubs && toggle(rowKey)}
        disabled={!hasSubs}
        className={`w-full ${ROW_GRID} px-4 py-1 text-left ${
          hasSubs ? 'hover:bg-bg-secondary/60 cursor-pointer' : 'cursor-default'
        }`}
      >
        {hasSubs ? (
          isOpen ? (
            <ChevronDown size={11} style={{ color: item.color }} />
          ) : (
            <ChevronRight size={11} style={{ color: item.color }} />
          )
        ) : (
          <ChevronRight size={11} style={{ color: item.color, opacity: 0.35 }} />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <CategoryIcon
            icon={item.icon}
            size={12}
            className="flex-shrink-0"
            style={{ color: item.color }}
          />
          <span className="text-xs text-text-primary truncate">{item.name}</span>
        </div>
        <span className="text-xs tabular-nums text-text-primary text-right">
          {formatBRL(item.curr)}
        </span>
        <span className="text-xs tabular-nums text-text-secondary text-right">
          {formatBRL(item.prev)}
        </span>
        <div className="flex flex-col items-end leading-tight">
          <span className={`flex items-center gap-1 text-xs font-bold tabular-nums ${color}`}>
            <Icon size={11} />
            {pctText}
          </span>
          <span className={`text-[10px] tabular-nums opacity-80 ${color}`}>{deltaText}</span>
        </div>
      </button>
      {isOpen && hasSubs && (
        <div className="bg-bg-secondary/60 divide-y divide-border/40">
          {item.subs.map((sub) => (
            <SubCategoryRow
              key={sub.id}
              sub={sub}
              higherIsBetter={higherIsBetter}
              hasPrev={hasPrev}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SubCategoryRowProps {
  sub: YoySubItem;
  higherIsBetter: boolean;
  hasPrev: boolean;
}

function SubCategoryRow({ sub, higherIsBetter, hasPrev }: SubCategoryRowProps) {
  const { color, Icon, pctText } = resolveTrend(sub.pct, higherIsBetter, hasPrev);
  const deltaText = `${sub.varianceAbs > 0 ? '+' : ''}${formatBRL(sub.varianceAbs)}`;
  return (
    <div className={`${ROW_GRID} px-4 py-0.5 pl-10`}>
      <ChevronRight size={10} style={{ color: sub.color, opacity: 0.5 }} />
      <div className="flex items-center gap-1.5 min-w-0">
        <CategoryIcon
          icon={sub.icon}
          size={11}
          className="flex-shrink-0"
          style={{ color: sub.color }}
        />
        <span className="text-[11px] text-text-secondary truncate">{sub.name}</span>
      </div>
      <span className="text-[11px] tabular-nums text-text-secondary text-right">
        {formatBRL(sub.curr)}
      </span>
      <span className="text-[11px] tabular-nums text-text-secondary/70 text-right">
        {formatBRL(sub.prev)}
      </span>
      <div className="flex flex-col items-end leading-tight">
        <span className={`flex items-center gap-1 text-[11px] font-bold tabular-nums ${color}`}>
          <Icon size={10} />
          {pctText}
        </span>
        <span className={`text-[10px] tabular-nums opacity-80 ${color}`}>{deltaText}</span>
      </div>
    </div>
  );
}

interface ResultadoRowProps {
  item: YoyItem;
  expanded: Set<string>;
  toggle: (key: string) => void;
  rowKey: string;
}

function ResultadoRow({ item, expanded, toggle, rowKey }: ResultadoRowProps) {
  const isOpen = expanded.has(rowKey);
  const hasSubs = item.subs.length > 0;
  const impact = item.resultadoImpact ?? 0;
  const color = impact > 0 ? 'text-accent-green' : impact < 0 ? 'text-accent-red' : 'text-text-secondary';
  const Icon = impact > 0 ? TrendingUp : impact < 0 ? TrendingDown : Minus;
  const deltaText = `${impact > 0 ? '+' : ''}${formatBRL(impact)}`;
  const pctText =
    item.pct === null
      ? 'n/d'
      : `${item.pct > 0 ? '+' : ''}${item.pct.toFixed(1)}%`;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasSubs && toggle(rowKey)}
        disabled={!hasSubs}
        className={`w-full ${ROW_GRID} px-4 py-1 text-left ${
          hasSubs ? 'hover:bg-bg-secondary/60 cursor-pointer' : 'cursor-default'
        }`}
      >
        {hasSubs ? (
          isOpen ? (
            <ChevronDown size={11} style={{ color: item.color }} />
          ) : (
            <ChevronRight size={11} style={{ color: item.color }} />
          )
        ) : (
          <ChevronRight size={11} style={{ color: item.color, opacity: 0.35 }} />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <CategoryIcon
            icon={item.icon}
            size={12}
            className="flex-shrink-0"
            style={{ color: item.color }}
          />
          <span className="text-xs text-text-primary truncate">{item.name}</span>
        </div>
        <span className="text-xs tabular-nums text-text-primary text-right">
          {formatBRL(item.curr)}
        </span>
        <span className="text-xs tabular-nums text-text-secondary text-right">
          {formatBRL(item.prev)}
        </span>
        <div className="flex flex-col items-end leading-tight">
          <span className={`flex items-center gap-1 text-xs font-bold tabular-nums ${color}`}>
            <Icon size={11} />
            {deltaText}
          </span>
          <span className={`text-[10px] tabular-nums opacity-80 ${color}`}>{pctText}</span>
        </div>
      </button>
      {isOpen && hasSubs && (
        <div className="bg-bg-secondary/60 divide-y divide-border/40">
          {item.subs.map((sub) => (
            <ResultadoSubRow key={sub.id} sub={sub} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultadoSubRow({ sub }: { sub: YoySubItem }) {
  const impact = sub.resultadoImpact ?? 0;
  const color = impact > 0 ? 'text-accent-green' : impact < 0 ? 'text-accent-red' : 'text-text-secondary';
  const Icon = impact > 0 ? TrendingUp : impact < 0 ? TrendingDown : Minus;
  const deltaText = `${impact > 0 ? '+' : ''}${formatBRL(impact)}`;
  const pctText =
    sub.pct === null
      ? 'n/d'
      : `${sub.pct > 0 ? '+' : ''}${sub.pct.toFixed(1)}%`;

  return (
    <div className={`${ROW_GRID} px-4 py-0.5 pl-10`}>
      <ChevronRight size={10} style={{ color: sub.color, opacity: 0.5 }} />
      <div className="flex items-center gap-1.5 min-w-0">
        <CategoryIcon
          icon={sub.icon}
          size={11}
          className="flex-shrink-0"
          style={{ color: sub.color }}
        />
        <span className="text-[11px] text-text-secondary truncate">{sub.name}</span>
      </div>
      <span className="text-[11px] tabular-nums text-text-secondary text-right">
        {formatBRL(sub.curr)}
      </span>
      <span className="text-[11px] tabular-nums text-text-secondary/70 text-right">
        {formatBRL(sub.prev)}
      </span>
      <div className="flex flex-col items-end leading-tight">
        <span className={`flex items-center gap-1 text-[11px] font-bold tabular-nums ${color}`}>
          <Icon size={10} />
          {deltaText}
        </span>
        <span className={`text-[10px] tabular-nums opacity-80 ${color}`}>{pctText}</span>
      </div>
    </div>
  );
}

function ColumnHeader({ showImpactCol = false }: { showImpactCol?: boolean }) {
  return (
    <div
      className={`${ROW_GRID} px-4 py-1 text-[9px] uppercase tracking-wider text-text-secondary/80`}
    >
      <span />
      <span>Categoria</span>
      <span className="text-right">Atual</span>
      <span className="text-right">Anterior</span>
      <span className="text-right">{showImpactCol ? 'Impacto' : '%'}</span>
    </div>
  );
}

// ---------- Helpers ----------

function resolveTrend(
  pct: number | null,
  higherIsBetter: boolean,
  hasPrev: boolean,
): { color: string; Icon: typeof TrendingUp; pctText: string } {
  let color = 'text-text-secondary';
  let Icon: typeof TrendingUp = Minus;
  let pctText = '—';

  if (!hasPrev) {
    pctText = 'sem dados';
  } else if (pct === null) {
    pctText = 'n/d';
  } else {
    const isBetter = higherIsBetter ? pct > 0 : pct < 0;
    const isWorse = higherIsBetter ? pct < 0 : pct > 0;
    if (Math.abs(pct) < 0.05) {
      color = 'text-text-secondary';
      Icon = Minus;
    } else if (isBetter) {
      color = 'text-accent-green';
      Icon = pct > 0 ? TrendingUp : TrendingDown;
    } else if (isWorse) {
      color = 'text-accent-red';
      Icon = pct > 0 ? TrendingUp : TrendingDown;
    }
    const sign = pct > 0 ? '+' : '';
    pctText = `${sign}${pct.toFixed(1)}%`;
  }

  return { color, Icon, pctText };
}
