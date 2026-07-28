import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  formatBRL0,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import { resolveTrend, type YoyItem, type YoySubItem, type GroupTotal } from './yoyShared';

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

/** Barras visíveis antes do "ver todas" — o resto vira uma linha agregada. */
const TOP_N = 8;
/** Abaixo disso a variação é ruído contábil e só alonga o card. */
const MIN_DELTA = 1;

type GroupKey = 'expenses' | 'income' | 'resultado';

function computePct(curr: number, prev: number, absBase = false): number | null {
  if (prev === 0) return null;
  const base = absBase ? Math.abs(prev) : prev;
  return ((curr - prev) / base) * 100;
}

const signed0 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatBRL0(Math.abs(v))}`;

/**
 * Cada grupo tem seu próprio vocabulário de direção, mas a REGRA DE COR é uma
 * só no card inteiro: coral = piorou o seu bolso, menta = melhorou. Por isso
 * "recebeu mais" fica à esquerda em Receitas — do lado bom, junto com
 * "gastou menos". A posição segue o efeito, não o sinal do número.
 */
const GROUPS: Array<{
  key: GroupKey;
  label: string;
  higherIsBetter: boolean;
  left: string;
  right: string;
  netNoun: string;
}> = [
  { key: 'expenses', label: 'Despesas', higherIsBetter: false, left: 'gastou menos', right: 'gastou mais', netNoun: 'em despesas' },
  { key: 'income', label: 'Receitas', higherIsBetter: true, left: 'recebeu mais', right: 'recebeu menos', netNoun: 'em receitas' },
  { key: 'resultado', label: 'Resultado', higherIsBetter: true, left: 'ajudou', right: 'piorou', netNoun: 'no resultado' },
];

export function YoyDeviationPanel({
  transactions,
  categories,
  monthYear,
  isMonthInProgress,
  periodLabel,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<GroupKey>('expenses');
  const [showAll, setShowAll] = useState(false);

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

  const group = GROUPS.find((g) => g.key === activeGroup)!;

  // Uma barra por categoria: `delta` é o número que se mostra (variação no
  // vocabulário do grupo) e `harm` é o efeito no bolso, que decide lado e cor.
  const bars = useMemo(() => {
    const toBar = (it: YoyItem | YoySubItem, harmSign: 1 | -1) => {
      const delta = activeGroup === 'resultado' ? (it.resultadoImpact ?? 0) : it.varianceAbs;
      return { id: it.id, name: it.name, color: it.color, delta, harm: harmSign * delta };
    };

    const items: YoyItem[] =
      activeGroup === 'resultado'
        ? [...data.resultadoHelping, ...data.resultadoHurting]
        : activeGroup === 'expenses'
          ? data.expenseItems
          : data.incomeItems;

    // Despesa: gastar mais machuca (harm = +delta). Receita e Resultado: o
    // número já é "quanto melhorou", então machucar é o inverso.
    const sign: 1 | -1 = activeGroup === 'expenses' ? 1 : -1;

    return items
      .map((it) => ({
        ...toBar(it, sign),
        subs: it.subs.map((s) => toBar(s, sign)).filter((s) => Math.abs(s.delta) >= MIN_DELTA),
      }))
      .filter((b) => Math.abs(b.delta) >= MIN_DELTA)
      .sort((a, b) => Math.abs(b.harm) - Math.abs(a.harm));
  }, [activeGroup, data]);

  const visible = showAll ? bars : bars.slice(0, TOP_N);
  const hidden = bars.slice(visible.length);
  const hiddenNet = hidden.reduce((s, b) => s + b.delta, 0);
  const netDelta = bars.reduce((s, b) => s + b.delta, 0);
  // Escala compartilhada por categorias E subcategorias: uma barra filha nunca
  // pode parecer maior do que a mãe.
  const max = Math.max(...bars.map((b) => Math.abs(b.delta)), 1);

  const currentYear = monthYear.split('-')[0];

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div>
        <h3 className="text-title font-semibold text-text-primary">O que puxou o ano</h3>
        <p className="text-caption text-ink-3 mt-0.5">
          {periodLabel} {currentYear} vs {periodLabel} {data.prevYear} · por categoria
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

      {/* Os três totais viram o seletor do que as barras mostram: o resumo
          continua à vista, mas sem ser o corpo do card. */}
      <div className="grid grid-cols-3 gap-2">
        {GROUPS.map((g) => (
          <SummaryTile
            key={g.key}
            label={g.label}
            total={data.totals[g.key]}
            higherIsBetter={g.higherIsBetter}
            hasPrev={data.hasPrev}
            prevYear={data.prevYear}
            isSavingsRate={g.key === 'resultado'}
            active={activeGroup === g.key}
            onClick={() => {
              setActiveGroup(g.key);
              setExpanded(new Set());
              setShowAll(false);
            }}
          />
        ))}
      </div>

      {!data.hasPrev ? (
        <p className="text-caption text-ink-3 pt-1">
          Sem lançamentos em {data.prevYear} para comparar.
        </p>
      ) : bars.length === 0 ? (
        <p className="text-caption text-ink-3 pt-1">
          Nenhuma variação relevante em {group.label.toLowerCase()} contra {data.prevYear}.
        </p>
      ) : (
        <>
          <div className="space-y-1 pt-1">
            <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] text-caption text-ink-3 uppercase tracking-wider">
              <span className="text-right pr-2">{group.left}</span>
              <span />
              <span className="pl-2">{group.right}</span>
            </div>

            {visible.map((b) => {
              const open = expanded.has(b.id);
              return (
                <div key={b.id}>
                  <BarRow
                    name={b.name}
                    color={b.color}
                    delta={b.delta}
                    harm={b.harm}
                    max={max}
                    open={open}
                    onToggle={b.subs.length > 0 ? () => toggle(b.id) : undefined}
                  />
                  {open &&
                    b.subs.map((s) => (
                      <BarRow
                        key={s.id}
                        name={s.name}
                        color={s.color}
                        delta={s.delta}
                        harm={s.harm}
                        max={max}
                        sub
                      />
                    ))}
                </div>
              );
            })}

            {hidden.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="tap w-full grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] text-caption text-ink-3 hover:text-text-secondary transition-colors pt-0.5"
              >
                <span className="text-right pr-2 tnum">{signed0(hiddenNet)}</span>
                <span />
                <span className="pl-2 text-left">
                  + {hidden.length} {hidden.length === 1 ? 'categoria menor' : 'categorias menores'}
                </span>
              </button>
            )}

            {showAll && bars.length > TOP_N && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="tap w-full text-caption text-ink-3 hover:text-text-secondary transition-colors pt-0.5"
              >
                ver menos
              </button>
            )}
          </div>

          <p className="text-caption text-ink-3 pt-1 border-t border-border">
            Efeito líquido:{' '}
            <span className={`tnum ${netTone(netDelta, group.higherIsBetter)}`}>
              {signed0(netDelta)}
            </span>{' '}
            {group.netNoun} contra {data.prevYear}.
          </p>
        </>
      )}
    </div>
  );
}

function netTone(v: number, higherIsBetter: boolean): string {
  if (Math.abs(v) < MIN_DELTA) return 'text-ink-3';
  return (higherIsBetter ? v > 0 : v < 0) ? 'text-positive' : 'text-negative';
}

/* ---------------- Barra divergente ---------------- */

interface BarRowProps {
  name: string;
  color: string;
  delta: number;
  /** > 0 = piorou o bolso (direita, coral); < 0 = melhorou (esquerda, menta). */
  harm: number;
  max: number;
  sub?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

function BarRow({ name, color, delta, harm, max, sub, open, onToggle }: BarRowProps) {
  const worse = harm > 0;
  const width = `${Math.max((Math.abs(delta) / max) * 100, 1.5)}%`;
  const tone = worse ? 'text-negative' : 'text-positive';
  const bg = worse ? '#e05a4d' : '#34a873';
  const h = sub ? 'h-2.5' : 'h-4';
  const Chevron = open ? ChevronDown : ChevronRight;

  const label = (
    <span
      className={`truncate ${sub ? 'text-caption text-ink-3' : 'text-body text-text-secondary'}`}
    >
      {name}
    </span>
  );
  const value = (
    <span className={`text-caption tnum flex-shrink-0 ${tone}`}>{signed0(delta)}</span>
  );
  const bar = (
    <div
      className={`${h} ${worse ? 'rounded-r-[3px]' : 'rounded-l-[3px]'}`}
      style={{ width, backgroundColor: sub ? `${bg}99` : bg }}
      title={name}
    />
  );
  // A cor da categoria vive num tracinho ao lado do nome: pintar a barra com
  // ela quebraria a leitura de "coral = piorou / menta = melhorou".
  const chip = !sub && (
    <span
      className="w-0.5 h-3.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
    />
  );

  const inner = (
    <>
      <div className={`flex justify-end items-center gap-2 pr-2 min-w-0 ${sub ? 'pl-4' : ''}`}>
        {worse ? (
          <>
            {onToggle && <Chevron size={12} className="text-ink-3 flex-shrink-0" />}
            {label}
            {chip}
          </>
        ) : (
          <>
            {value}
            {bar}
          </>
        )}
      </div>
      <div className={`${h} w-px bg-border`} />
      <div className={`flex items-center gap-2 pl-2 min-w-0 ${sub ? 'pr-4' : ''}`}>
        {worse ? (
          <>
            {bar}
            {value}
          </>
        ) : (
          <>
            {chip}
            {label}
            {onToggle && <Chevron size={12} className="text-ink-3 flex-shrink-0" />}
          </>
        )}
      </div>
    </>
  );

  const cls = `grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center w-full ${
    sub ? 'py-px' : 'py-0.5'
  }`;

  if (!onToggle) return <div className={cls}>{inner}</div>;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={`${cls} tap text-left hover:bg-elevated/40 rounded-[4px] transition-colors`}>
      {inner}
    </button>
  );
}

/* ---------------- Tile de resumo (também é o seletor) ---------------- */

interface SummaryTileProps {
  label: string;
  total: GroupTotal;
  higherIsBetter: boolean;
  hasPrev: boolean;
  prevYear: number;
  isSavingsRate: boolean;
  active: boolean;
  onClick: () => void;
}

function SummaryTile({
  label,
  total,
  higherIsBetter,
  hasPrev,
  prevYear,
  isSavingsRate,
  active,
  onClick,
}: SummaryTileProps) {
  // No Resultado o % vira Δ da taxa de poupança em p.p.: percentual sobre base
  // negativa que cruza o zero não tem leitura humana (o antigo "−151,3%").
  const trend = isSavingsRate
    ? resolveTrend(total.savingsRatePp ?? null, true, { hasPrev, unit: 'pp' })
    : resolveTrend(total.pct, higherIsBetter, { hasPrev });

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hasPrev ? `${prevYear}: ${formatBRL0(total.prev)}` : undefined}
      className={`tap text-left rounded-control px-2.5 py-1.5 min-w-0 border transition-colors ${
        active
          ? 'bg-elevated border-border'
          : 'bg-bg-secondary border-transparent hover:border-border'
      }`}
    >
      <p className="text-caption uppercase tracking-wider text-ink-3 truncate">{label}</p>
      <p className="text-body tnum text-text-primary truncate">{formatBRL0(total.curr)}</p>
      <p className={`text-caption tnum truncate ${trend.color}`}>
        {trend.text} <span className="text-ink-3">vs {prevYear}</span>
      </p>
    </button>
  );
}
