import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { ALL_MONTHS } from '../shared/MonthSelector';
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

/** Linha-filha que devolve o que foi lançado direto na categoria-mãe. */
const DIRECT_SUFFIX = '__direct';
const DIRECT_NAME = 'Sem subcategoria';

/** Barras visíveis antes do "ver todas" — o resto vira uma linha agregada. */
const TOP_N = 8;
/** Abaixo disso a variação é ruído contábil e só alonga o card. */
const MIN_DELTA = 1;
/** Fração dos meses comparados a partir da qual um gasto é "de todo mês". */
const CADENCE_SHARE = 0.6;
/** Janela mínima para a cadência significar algo: em 1–3 meses, "apareceu em
 *  2 de 3" não separa o mensal do eventual, e o rótulo enganaria mais do que
 *  informaria. */
const CADENCE_MIN_MONTHS = 4;

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

    /**
     * Além do dinheiro, os MESES em que a categoria apareceu — é o que separa
     * "aluguel todo mês" de "obra em março". Sem cadência, o card soma um
     * reajuste permanente com um gasto de uma vez só e chama os dois de
     * aumento.
     */
    type Slice = {
      curr: number;
      prev: number;
      /** Só o mês corrente do ano atual. Serve para tirar um mês PELA METADE
       *  da conta da taxa mensal — senão um junho ainda aberto rebaixaria a
       *  base recorrente e a projeção sairia otimista de graça. */
      currTail: number;
      mCurr: Set<number>;
      mPrev: Set<number>;
    };
    const newSlice = (): Slice => ({
      curr: 0,
      prev: 0,
      currTail: 0,
      mCurr: new Set(),
      mPrev: new Set(),
    });
    const addTo = (s: Slice, amt: number, isCurr: boolean, month: number) => {
      if (isCurr) {
        s.curr += amt;
        s.mCurr.add(month);
        if (month === m) s.currTail += amt;
      } else {
        s.prev += amt;
        s.mPrev.add(month);
      }
    };

    // `direct` = lançado na própria mãe, sem subcategoria. Guardado à parte
    // (em vez de deduzido de total − subs) porque também precisa dos meses
    // dele para ser classificado como qualquer outra folha.
    type Bucket = { total: Slice; direct: Slice; subs: Map<string, Slice> };

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
        targetMap.set(parentId, { total: newSlice(), direct: newSlice(), subs: new Map() });
      }
      const bucket = targetMap.get(parentId)!;
      addTo(bucket.total, amt, isCurr, tm);

      if (cat?.parentId) {
        if (!bucket.subs.has(catId)) bucket.subs.set(catId, newSlice());
        addTo(bucket.subs.get(catId)!, amt, isCurr, tm);
      } else {
        addTo(bucket.direct, amt, isCurr, tm);
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

    /**
     * Recorrente = apareceu em pelo menos 60% dos meses comparados, no ano em
     * que esteve mais presente (uma despesa que rodava todo mês em 2025 e
     * sumiu em 2026 é uma queda de BASE, não um evento).
     *
     * Vale só para a FOLHA — subcategoria ou lançamento direto na mãe. Julgar
     * a mãe misturaria o aluguel de todo mês com a obra de março e devolveria
     * "Moradia é recorrente", que é verdade sobre a categoria e mentira sobre
     * o que moveu o número.
     */
    const isRecurring = (s: Slice) =>
      Math.max(s.mCurr.size, s.mPrev.size) >= Math.ceil(m * CADENCE_SHARE);

    const toLeaf = (id: string, s: Slice, meta: ReturnType<typeof resolveCategoryMeta>) => ({
      id,
      name: meta.name,
      icon: meta.icon,
      color: meta.color,
      curr: s.curr,
      prev: s.prev,
      currTail: s.currTail,
      varianceAbs: s.curr - s.prev,
      pct: computePct(s.curr, s.prev),
      recurring: isRecurring(s),
    });

    function buildItems(map: Map<string, Bucket>): YoyItem[] {
      const items: YoyItem[] = [];
      for (const [parentId, bucket] of map.entries()) {
        if (bucket.total.curr === 0 && bucket.total.prev === 0) continue;
        const meta = resolveCategoryMeta(parentId);
        const subs: YoySubItem[] = [];
        for (const [subId, subSlice] of bucket.subs.entries()) {
          if (subSlice.curr === 0 && subSlice.prev === 0) continue;
          subs.push(toLeaf(subId, subSlice, resolveCategoryMeta(subId)));
        }

        // RESÍDUO: lançamento feito DIRETO na categoria-mãe soma no total dela
        // mas não vira `sub` nenhum (só subcategoria vira). Sem esta linha a
        // expansão não fechava com a barra de cima — o caso real era Moradia
        // −12.778 na mãe contra +6.030 somando as filhas, com R$ 18,8 mil
        // invisíveis. Ela existe para a decomposição ser EXAUSTIVA por
        // construção, não por sorte de o usuário sempre usar subcategoria.
        // (Só quando há subcategorias: sem elas a mãe já É a folha.)
        const { direct } = bucket;
        if (subs.length > 0 && (Math.abs(direct.curr) >= 0.005 || Math.abs(direct.prev) >= 0.005)) {
          subs.push(
            toLeaf(`${parentId}${DIRECT_SUFFIX}`, direct, { ...meta, name: DIRECT_NAME }),
          );
        }

        subs.sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs));
        items.push({
          ...toLeaf(parentId, bucket.total, meta),
          subs,
        });
      }
      items.sort((a, b) => Math.abs(b.varianceAbs) - Math.abs(a.varianceAbs));
      return items;
    }

    const expenseItems = buildItems(expMap);
    const incomeItems = buildItems(incMap);

    /**
     * Quanto a base que se repete gasta POR MÊS. Soma as folhas recorrentes
     * (a mãe agregaria o eventual junto) e divide pelos meses FECHADOS.
     */
    function recurringMonthly(items: YoyItem[]): number {
      const closed = isMonthInProgress ? m - 1 : m;
      if (closed <= 0) return 0;
      let sum = 0;
      for (const it of items) {
        for (const leaf of it.subs.length > 0 ? it.subs : [it]) {
          if (!leaf.recurring) continue;
          sum += leaf.curr - (isMonthInProgress ? (leaf.currTail ?? 0) : 0);
        }
      }
      return sum / closed;
    }

    // Build resultado lists (impact on resultado: +varianceAbs for income, -varianceAbs for expenses)
    const resultadoHelping: YoyItem[] = [];
    const resultadoHurting: YoyItem[] = [];

    function pushWithImpact(item: YoyItem, sign: 1 | -1) {
      const resultadoImpact = sign * item.varianceAbs;
      if (Math.abs(resultadoImpact) < 1) return;
      // Sem filtrar por MIN_DELTA aqui: a lista de folhas precisa ficar
      // COMPLETA para a soma recorrente+pontual bater com o efeito líquido.
      // Quem esconde folha irrelevante é a montagem das barras, lá embaixo.
      // O grupo Resultado junta os dois lados numa lista só, e a mesma
      // categoria pode aparecer nos dois (o caso certo é "Sem categoria", que
      // existe em receita e em despesa). Sem o prefixo, as duas linhas dividem
      // a chave: React reclama e expandir uma abria a outra junto. O id aqui
      // só identifica a linha — não é usado para buscar categoria.
      const side = sign === 1 ? 'inc' : 'exp';
      const subs = item.subs
        .map((s) => ({ ...s, id: `${side}:${s.id}`, resultadoImpact: sign * s.varianceAbs }))
        .sort((a, b) => Math.abs(b.resultadoImpact!) - Math.abs(a.resultadoImpact!));
      const entry: YoyItem = { ...item, id: `${side}:${item.id}`, resultadoImpact, subs };
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
      cadenceReliable: m >= CADENCE_MIN_MONTHS,
      cadenceMonths: Math.ceil(m * CADENCE_SHARE),
      windowMonths: m,
      recurringMonthly: {
        expenses: recurringMonthly(expenseItems),
        income: recurringMonthly(incomeItems),
      },
      // Dinheiro sem classificação não é uma categoria como as outras: é o
      // tamanho do buraco na análise. Fica fora das barras, num aviso.
      uncategorized: {
        expenses: expMap.get(UNCATEGORIZED_ID)?.total ?? null,
        income: incMap.get(UNCATEGORIZED_ID)?.total ?? null,
      },
    };
  }, [transactions, categories, monthYear, isMonthInProgress]);
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
      return {
        id: it.id,
        name: it.name,
        color: it.color,
        delta,
        harm: harmSign * delta,
        // Base dos dois anos: sem ela "+R$ 7.163" não distingue uma deriva de
        // 5% de uma explosão de 10×, que pedem decisões opostas.
        curr: it.curr,
        prev: it.prev,
        recurring: it.recurring ?? false,
      };
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
      .map((it) => {
        const subs = it.subs.map((s) => toBar(s, sign));
        return {
          ...toBar(it, sign),
          // Folhas: a decomposição completa da barra (subcategorias +
          // lançamento direto), ou ela mesma quando não tem filha. É sobre
          // esta lista — e não sobre as mães — que a cadência é somada, e por
          // ser completa (sem MIN_DELTA) ela fecha exatamente no líquido.
          leaves: subs.length > 0 ? subs : [toBar(it, sign)],
          isLeaf: subs.length === 0,
          subs: subs.filter((s) => Math.abs(s.delta) >= MIN_DELTA),
        };
      })
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

  // Aviso de cobertura. O grupo Resultado usa o balde de DESPESA: é onde o
  // não-classificado vive na prática, e a fração sobre um saldo (que pode ser
  // negativo) não teria leitura.
  const uncatGroup: 'expenses' | 'income' = activeGroup === 'income' ? 'income' : 'expenses';
  const uncatBucket =
    uncatGroup === 'income' ? data.uncategorized.income : data.uncategorized.expenses;
  const uncatCurr = uncatBucket?.curr ?? 0;
  const uncatTotal = data.totals[uncatGroup].curr;
  const uncatShare = uncatTotal > 0 ? (uncatCurr / uncatTotal) * 100 : null;

  // A pergunta de planejamento que o card não respondia: dos +R$ 82 mil,
  // quanto volta no semestre que vem? Só a parte que roda todo mês. Some
  // sobre as FOLHAS (subcategoria / lançamento direto), nunca sobre as mães.
  const cadence = useMemo(() => {
    if (!data.cadenceReliable) return null;
    let recorrente = 0;
    let pontual = 0;
    for (const b of bars) {
      for (const leaf of b.leaves) {
        if (leaf.recurring) recorrente += leaf.delta;
        else pontual += leaf.delta;
      }
    }
    return { recorrente, pontual };
  }, [bars, data.cadenceReliable]);

  // O fecho do raciocínio: se só a base recorrente rodar até dezembro, onde o
  // ano termina. Deliberadamente NÃO estima os pontuais que ainda vão
  // aparecer no 2º semestre — inventar um número para o imprevisto seria pior
  // do que dizer que ele está de fora. Em despesa, portanto, é um piso.
  const projection = useMemo(() => {
    const remaining = 12 - data.windowMonths;
    if (!data.cadenceReliable || remaining <= 0) return null;
    const at = (curr: number, monthly: number) => curr + monthly * remaining;
    const exp = at(data.totals.expenses.curr, data.recurringMonthly.expenses);
    const inc = at(data.totals.income.curr, data.recurringMonthly.income);
    return {
      value: activeGroup === 'expenses' ? exp : activeGroup === 'income' ? inc : inc - exp,
      remaining,
    };
  }, [activeGroup, data]);

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
                    curr={b.curr}
                    prev={b.prev}
                    prevYear={data.prevYear}
                    currYear={currentYear}
                    oneOff={!!cadence && b.isLeaf && !b.recurring}
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
                        curr={s.curr}
                        prev={s.prev}
                        prevYear={data.prevYear}
                        currYear={currentYear}
                        oneOff={!!cadence && !s.recurring}
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

          {uncatShare !== null && uncatShare >= 0.5 && (
            <p className="text-body text-text-secondary leading-snug pt-1 flex items-start gap-1.5">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-status-warn" />
              <span>
                <span className="tnum text-status-warn">{formatBRL0(uncatCurr)}</span> (
                {uncatShare.toFixed(0)}%) {uncatGroup === 'income' ? 'das receitas' : 'das despesas'}{' '}
                de {currentYear} estão sem categoria — o que puxou o ano fica em parte inexplicado
                até classificá-las.{' '}
                <Link
                  to={`/transacoes?mes=${ALL_MONTHS}&categoria=uncategorized`}
                  className="text-accent hover:underline whitespace-nowrap"
                >
                  Classificar
                </Link>
              </span>
            </p>
          )}

          {/* Conclusões do card. Em text-body e não em caption: são as três
              frases que respondem "e daí?" — a leitura que sobra depois de as
              barras terem chamado a atenção — e a 11px mudas ninguém lê. */}
          <div className="pt-2 border-t border-border space-y-1 text-body text-text-secondary leading-snug">
            <p>
              Efeito líquido:{' '}
              <span className={`tnum font-semibold ${netTone(netDelta, group.higherIsBetter)}`}>
                {signed0(netDelta)}
              </span>{' '}
              {group.netNoun} contra {data.prevYear}.
            </p>
            {cadence && (
              <p
                title={`Recorrente = subcategoria (ou lançamento direto na categoria) presente em pelo menos ${data.cadenceMonths} dos ${data.windowMonths} meses comparados. Gasto anual — IPTU, seguro, matrícula — entra como pontual: não volta no semestre que vem.`}
              >
                Desse total,{' '}
                <span className={`tnum ${netTone(cadence.recorrente, group.higherIsBetter)}`}>
                  {signed0(cadence.recorrente)}
                </span>{' '}
                é base recorrente (segue no 2º semestre) e{' '}
                <span className={`tnum ${netTone(cadence.pontual, group.higherIsBetter)}`}>
                  {signed0(cadence.pontual)}
                </span>{' '}
                foi pontual.
              </p>
            )}
            {projection && (
              <p
                title={`${periodLabel} realizado mais a base recorrente rodando nos ${projection.remaining} meses que faltam. Não inclui gastos pontuais que ainda vão aparecer — em despesa, é um piso, não uma previsão.`}
              >
                No ritmo recorrente, {currentYear} fecha perto de{' '}
                <span className="tnum font-semibold text-text-primary">
                  {activeGroup === 'resultado'
                    ? signed0(projection.value)
                    : formatBRL0(projection.value)}
                </span>
                .
              </p>
            )}
          </div>
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
  /** Valores dos dois anos, para o % ao lado e a base no tooltip. */
  curr: number;
  prev: number;
  prevYear: number;
  currYear: string;
  /** Folha que NÃO se repete todo mês. Indefinido em linha-mãe (que agrega
   *  naturezas diferentes) e quando a janela é curta demais para julgar. */
  oneOff?: boolean;
  sub?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

/**
 * Variação relativa da própria categoria — o que diz se um número grande é
 * deriva ou ruptura.
 *
 * Só sai quando a base é POSITIVA: categoria que fecha negativa (reembolso
 * maior que o gasto) produziria percentual de sinal invertido, ilegível. Acima
 * de ~10× o percentual perde a escala e vira multiplicador ("×11"), que é como
 * se fala do número.
 */
function pctLabel(curr: number, prev: number): string | null {
  if (prev > 0.005) {
    const p = ((curr - prev) / prev) * 100;
    if (Math.abs(p) < 1) return null; // ruído; a barra já mostra que é pequeno
    if (p >= 900) return `×${(curr / prev).toFixed(0)}`;
    return `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%`;
  }
  if (Math.abs(prev) <= 0.005 && curr > 0) return 'novo';
  return null;
}

function BarRow({
  name,
  color,
  delta,
  harm,
  max,
  curr,
  prev,
  prevYear,
  currYear,
  oneOff,
  sub,
  open,
  onToggle,
}: BarRowProps) {
  const worse = harm > 0;
  const width = `${Math.max((Math.abs(delta) / max) * 100, 1.5)}%`;
  const tone = worse ? 'text-negative' : 'text-positive';
  const bg = worse ? '#e05a4d' : '#34a873';
  const h = sub ? 'h-2.5' : 'h-4';
  const Chevron = open ? ChevronDown : ChevronRight;
  const pct = pctLabel(curr, prev);
  // A base completa fica no tooltip: na linha ela roubaria a coluna do nome.
  const baseTitle = `${name} · ${prevYear}: ${formatBRL0(prev)} → ${currYear}: ${formatBRL0(curr)}`;

  const label = (
    <>
      <span
        className={`truncate ${sub ? 'text-caption text-ink-3' : 'text-body text-text-secondary'}`}
      >
        {name}
      </span>
      {/* Só o pontual é marcado: recorrente é o que se espera de um gasto, e
          marcar os dois lados vira ruído em 8 linhas seguidas. */}
      {oneOff && (
        <span className="text-caption text-ink-3 flex-shrink-0 hidden sm:inline">pontual</span>
      )}
    </>
  );
  const value = (
    // Linha principal em text-body: é o número que se lê na varredura. As
    // subcategorias seguem em caption para a hierarquia continuar visível.
    <span className={`${sub ? 'text-caption' : 'text-body'} tnum flex-shrink-0 ${tone}`}>
      {signed0(delta)}
      {/* Some no celular pelo mesmo motivo do "vs 2025" nos tiles: com ~110px
          por coluna, o valor em reais é o que precisa sobreviver. */}
      {pct && <span className="text-ink-3 hidden sm:inline"> {pct}</span>}
    </span>
  );
  const bar = (
    <div
      className={`${h} ${worse ? 'rounded-r-[3px]' : 'rounded-l-[3px]'}`}
      style={{ width, backgroundColor: sub ? `${bg}99` : bg }}
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

  if (!onToggle) return <div className={cls} title={baseTitle}>{inner}</div>;
  return (
    // Sem `.tap` de proposito: os 44px so valeriam para as linhas
    // expansiveis, e no celular a lista ficava com um degrau de altura a cada
    // categoria com subcategoria. Numa lista densa, ritmo uniforme vale mais.
    <button type="button" onClick={onToggle} aria-expanded={open} title={baseTitle} className={`${cls} text-left hover:bg-elevated/40 rounded-[4px] transition-colors`}>
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
        {trend.text}{' '}
        {/* No celular os 3 tiles dividem ~110px cada e "vs 2025" era cortado
            no meio; a comparação já está no subtítulo do card. */}
        <span className="text-ink-3 hidden sm:inline">vs {prevYear}</span>
      </p>
    </button>
  );
}
