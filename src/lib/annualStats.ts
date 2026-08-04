import {
  getMonthYear,
  getMonthYearOffset,
  getClosedMonthYear,
  getExcludedFromTotalsIds,
  countsInTotals,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
} from './utils';
import type { Transaction, Category, Budget } from '../types';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Métricas do dashboard ANUAL — cálculo puro, sem React.
 *
 * A tela anual tem UMA janela e DUAS leituras que convivem o tempo todo:
 *
 *   12M  — os 12 meses encerrados no último mês FECHADO. É o eixo de tudo.
 *          O mês em andamento nunca entra: números pela metade envenenam
 *          qualquer média (mesma regra da tela mensal, `getClosedMonthYear`).
 *   Ano  — janeiro do ano corrente até o mesmo último mês fechado. É sempre um
 *          SUBCONJUNTO dos 12M, o que torna as duas somas auto-verificáveis.
 *
 * Toda contabilidade passa pelos helpers de `utils.ts` (`countsInTotals`,
 * `isIncomeAmount`/`isExpenseAmount`, `accountingDate`): transferência fora dos
 * totais, reembolso como contra-despesa, reembolso vinculado ancorado no mês da
 * despesa. Nenhuma dessas regras é reimplementada aqui.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-08" → "ago/26". Rótulo de eixo e de coluna. */
export function shortMonthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-');
  return `${MONTH_ABBR[Number(m) - 1]}/${y.slice(2)}`;
}

export interface AnnualPeriod {
  /** 12 chaves "YYYY-MM" em ordem ascendente, terminando no último mês fechado. */
  months: string[];
  /** Subconjunto de `months` pertencente ao ano corrente. Vazio em janeiro. */
  ytdMonths: string[];
  /** Último mês fechado — o fim das duas janelas. */
  endKey: string;
  /** Ano corrente (do calendário, não do fim da janela). */
  year: number;
  /** "set/25 – ago/26" */
  label: string;
  /** "jan–ago/26", ou "sem mês fechado em 2026". */
  ytdLabel: string;
  /** "Jan–Ago" — sem ano, para quem já imprime o ano ao lado. */
  ytdRangeLabel: string;
}

/**
 * A janela é derivada do relógio, não de escolha do usuário — a chave do
 * dashboard é só Mês/Ano, e o anual mostra as duas leituras juntas.
 */
export function resolveAnnualPeriod(): AnnualPeriod {
  const endKey = getClosedMonthYear();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(getMonthYearOffset(endKey, -i));

  const year = Number(getMonthYear().slice(0, 4));
  const ytdMonths = months.filter((m) => Number(m.slice(0, 4)) === year);

  return {
    months,
    ytdMonths,
    endKey,
    year,
    label: `${shortMonthLabel(months[0])} – ${shortMonthLabel(endKey)}`,
    ytdLabel:
      ytdMonths.length > 0
        ? `${MONTH_ABBR[Number(ytdMonths[0].slice(5)) - 1]}–${shortMonthLabel(
            ytdMonths[ytdMonths.length - 1]
          )}`
        : `sem mês fechado em ${year}`,
    ytdRangeLabel:
      ytdMonths.length > 0
        ? (() => {
            const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
            const last = MONTH_ABBR[Number(ytdMonths[ytdMonths.length - 1].slice(5)) - 1];
            return ytdMonths.length === 1 ? cap(last) : `${cap(MONTH_ABBR[0])}–${cap(last)}`;
          })()
        : '',
  };
}

export interface AnnualMonthRow {
  key: string;
  /** "ago/26" */
  label: string;
  /** Receitas do mês, POSITIVO. */
  income: number;
  /** Despesas do mês, POSITIVO (é o valor gasto, não o sinal contábil). */
  expense: number;
  /** income − expense. Negativo = mês no vermelho. */
  result: number;
  /** Saldo acumulado, semeado por `saldoAnterior`. */
  saldo: number;
  /** Marca a faixa do ano corrente dentro da série de 12 meses. */
  isCurrentYear: boolean;
  /** Mês sem nenhum lançamento que conte — a linha esmaece na tabela. */
  empty: boolean;
}

export interface WindowTotals {
  income: number;
  expense: number;
  result: number;
  /** Quantidade de meses da janela (o divisor das médias). */
  months: number;
  /** Meses com pelo menos um lançamento — 0 significa janela sem dado. */
  monthsWithData: number;
  /** Resultado ÷ receitas. `null` quando não entrou nada (divisão sem sentido). */
  savingsRate: number | null;
}

export interface AnnualStats {
  period: AnnualPeriod;
  rows: AnnualMonthRow[];
  /** Saldo acumulado de TUDO que é anterior ao primeiro mês da janela. */
  saldoAnterior: number;
  /** Últimos 12 meses fechados. */
  m12: WindowTotals;
  /** Os 12 meses ANTERIORES a esses — a régua do delta dos indicadores. */
  prevM12: WindowTotals;
  /** Ano corrente (jan → último mês fechado). */
  ytd: WindowTotals;
  /** O mesmo recorte de meses no ano passado. */
  prevYtd: WindowTotals;
  best: AnnualMonthRow | null;
  worst: AnnualMonthRow | null;
  /** Meses de resultado positivo dentro dos 12. */
  positiveMonths: number;
  hasData: boolean;
}

/** Acumulador por mês, o passe único que alimenta tudo. */
interface MonthAgg {
  income: number;
  expense: number;
  count: number;
}

function emptyAgg(): MonthAgg {
  return { income: 0, expense: 0, count: 0 };
}

function totalsFor(byMonth: Map<string, MonthAgg>, months: string[]): WindowTotals {
  let income = 0;
  let expense = 0;
  let monthsWithData = 0;
  for (const key of months) {
    const a = byMonth.get(key);
    if (!a) continue;
    income += a.income;
    expense += a.expense;
    if (a.count > 0) monthsWithData += 1;
  }
  const result = income - expense;
  return {
    income,
    expense,
    result,
    months: months.length,
    monthsWithData,
    savingsRate: income > 0 ? result / income : null,
  };
}

/**
 * Agrega a base inteira por mês uma única vez e recorta as quatro janelas
 * (12M, 12M anteriores, ano corrente, mesmo período do ano passado) desse
 * mesmo mapa. `saldoAnterior` soma tudo que antecede a janela — a mesma regra
 * do relatório de fluxo de caixa, para as duas telas darem o mesmo número.
 */
export function computeAnnualStats(
  transactions: Transaction[],
  categories: Category[],
  period: AnnualPeriod
): AnnualStats {
  const excludedIds = getExcludedFromTotalsIds(categories);
  const firstKey = period.months[0];

  const byMonth = new Map<string, MonthAgg>();
  let saldoAnterior = 0;

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    const key = getMonthYear(accountingDate(t));

    // Comparação de string funciona para "YYYY-MM" (zero-padded, ordem lexical
    // = ordem cronológica) — é o mesmo teste do CashFlowReport.
    if (key < firstKey) {
      saldoAnterior += t.amount;
      continue;
    }

    let agg = byMonth.get(key);
    if (!agg) {
      agg = emptyAgg();
      byMonth.set(key, agg);
    }
    agg.count += 1;
    if (isIncomeAmount(t)) agg.income += t.amount;
    // Reembolso é contra-despesa: `-amount` de um positivo SUBTRAI do gasto.
    else if (isExpenseAmount(t)) agg.expense += -t.amount;
  }

  // Os 12 meses anteriores à janela ficaram fora do mapa (caíram em
  // saldoAnterior), então precisam de um segundo passe restrito.
  const prevMonths = period.months.map((m) => getMonthYearOffset(m, -12));
  const prevYtdMonths = period.ytdMonths.map((m) => getMonthYearOffset(m, -12));
  const prevSet = new Set([...prevMonths, ...prevYtdMonths]);
  const prevByMonth = new Map<string, MonthAgg>();
  if (prevSet.size > 0) {
    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const key = getMonthYear(accountingDate(t));
      if (!prevSet.has(key)) continue;
      let agg = prevByMonth.get(key);
      if (!agg) {
        agg = emptyAgg();
        prevByMonth.set(key, agg);
      }
      agg.count += 1;
      if (isIncomeAmount(t)) agg.income += t.amount;
      else if (isExpenseAmount(t)) agg.expense += -t.amount;
    }
  }

  let running = saldoAnterior;
  const rows: AnnualMonthRow[] = period.months.map((key) => {
    const a = byMonth.get(key) ?? emptyAgg();
    const result = a.income - a.expense;
    running += result;
    return {
      key,
      label: shortMonthLabel(key),
      income: a.income,
      expense: a.expense,
      result,
      saldo: running,
      isCurrentYear: Number(key.slice(0, 4)) === period.year,
      empty: a.count === 0,
    };
  });

  const withData = rows.filter((r) => !r.empty);
  const best = withData.reduce<AnnualMonthRow | null>(
    (acc, r) => (acc === null || r.result > acc.result ? r : acc),
    null
  );
  const worst = withData.reduce<AnnualMonthRow | null>(
    (acc, r) => (acc === null || r.result < acc.result ? r : acc),
    null
  );

  return {
    period,
    rows,
    saldoAnterior,
    m12: totalsFor(byMonth, period.months),
    prevM12: totalsFor(prevByMonth, prevMonths),
    ytd: totalsFor(byMonth, period.ytdMonths),
    prevYtd: totalsFor(prevByMonth, prevYtdMonths),
    best,
    worst,
    positiveMonths: withData.filter((r) => r.result > 0).length,
    hasData: withData.length > 0,
  };
}

/* ─────────────────────────── Matriz categoria × mês ─────────────────────── */

export interface MatrixRow {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  /** chave "YYYY-MM" → valor POSITIVO do mês. */
  byMonth: Record<string, number>;
  total12m: number;
  /** Média sobre os meses com valor (mês zerado não dilui a média). */
  average: number;
  children: MatrixRow[];
}

export interface AnnualMatrix {
  income: MatrixRow[];
  expense: MatrixRow[];
  /** Maior célula de cada bloco — a régua da escala de cor do mapa de calor. */
  incomeMax: number;
  expenseMax: number;
  incomeTotals: Record<string, number>;
  expenseTotals: Record<string, number>;
  incomeTotal12m: number;
  expenseTotal12m: number;
  /** Fatia das 5 maiores categorias no total de despesas (0–1). */
  expenseConcentration: number | null;
  /** Meses mais caros, do mais caro para o menos — a leitura de sazonalidade. */
  expensivestMonths: string[];
}

const UNCATEGORIZED = '__uncategorized';

function blankRow(categoryId: string, name: string, icon: string, color: string): MatrixRow {
  return { categoryId, name, icon, color, byMonth: {}, total12m: 0, average: 0, children: [] };
}

function finishRow(row: MatrixRow, period: AnnualPeriod): MatrixRow {
  const values = period.months.map((m) => row.byMonth[m] ?? 0);
  const nonZero = values.filter((v) => v !== 0);
  row.total12m = values.reduce((s, v) => s + v, 0);
  row.average = nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
  return row;
}

/**
 * Categoria × mês, em dois blocos (receitas e despesas), com as raízes
 * agregando as subcategorias e guardando os filhos para o drill-down.
 *
 * `incomeMax`/`expenseMax` saem daqui de propósito: a escala do mapa de calor é
 * do BLOCO INTEIRO, não de cada linha. Normalizar por linha (como o relatório
 * de evolução faz hoje) faz uma célula de R$ 80 ficar tão escura quanto uma de
 * R$ 3.000 e impede comparar linhas entre si.
 */
export function computeAnnualMatrix(
  transactions: Transaction[],
  categories: Category[],
  period: AnnualPeriod
): AnnualMatrix {
  const excludedIds = getExcludedFromTotalsIds(categories);
  const monthSet = new Set(period.months);
  const byId = new Map(categories.map((c) => [c.id, c]));

  // rootId -> row; e rootId -> (childId -> row)
  const incomeRoots = new Map<string, MatrixRow>();
  const expenseRoots = new Map<string, MatrixRow>();
  const incomeTotals: Record<string, number> = {};
  const expenseTotals: Record<string, number> = {};

  const bump = (row: MatrixRow, key: string, value: number) => {
    row.byMonth[key] = (row.byMonth[key] ?? 0) + value;
  };

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    const key = getMonthYear(accountingDate(t));
    if (!monthSet.has(key)) continue;

    const income = isIncomeAmount(t);
    const expense = isExpenseAmount(t);
    if (!income && !expense) continue;

    const value = income ? t.amount : -t.amount;
    const roots = income ? incomeRoots : expenseRoots;
    const totals = income ? incomeTotals : expenseTotals;
    totals[key] = (totals[key] ?? 0) + value;

    const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
    const root = cat?.parentId ? byId.get(cat.parentId) ?? cat : cat;
    const rootId = root?.id ?? UNCATEGORIZED;

    let rootRow = roots.get(rootId);
    if (!rootRow) {
      rootRow = blankRow(rootId, root?.name ?? 'Sem categoria', root?.icon ?? 'circle', root?.color ?? '#6e6d69');
      roots.set(rootId, rootRow);
    }
    bump(rootRow, key, value);

    // Subcategoria vira filha; lançamento direto na raiz não gera filho.
    if (cat && cat.parentId) {
      let child = rootRow.children.find((c) => c.categoryId === cat.id);
      if (!child) {
        child = blankRow(cat.id, cat.name, cat.icon, cat.color || '#6e6d69');
        rootRow.children.push(child);
      }
      bump(child, key, value);
    }
  }

  const finalize = (roots: Map<string, MatrixRow>): MatrixRow[] =>
    Array.from(roots.values())
      .map((r) => {
        r.children = r.children.map((c) => finishRow(c, period)).sort((a, b) => b.total12m - a.total12m);
        return finishRow(r, period);
      })
      .filter((r) => r.total12m !== 0)
      .sort((a, b) => b.total12m - a.total12m);

  const income = finalize(incomeRoots);
  const expense = finalize(expenseRoots);

  // A régua da cor considera raízes E filhos: uma subcategoria expandida não
  // pode estourar a escala e ficar mais escura que o máximo declarado.
  const maxOf = (rows: MatrixRow[]) => {
    let max = 0;
    for (const r of rows) {
      for (const m of period.months) {
        max = Math.max(max, Math.abs(r.byMonth[m] ?? 0));
        for (const c of r.children) max = Math.max(max, Math.abs(c.byMonth[m] ?? 0));
      }
    }
    return max;
  };

  const sumOver = (totals: Record<string, number>) =>
    period.months.reduce((s, m) => s + (totals[m] ?? 0), 0);

  const expenseTotal12m = sumOver(expenseTotals);
  const top5 = expense.slice(0, 5).reduce((s, r) => s + r.total12m, 0);

  return {
    income,
    expense,
    incomeMax: maxOf(income),
    expenseMax: maxOf(expense),
    incomeTotals,
    expenseTotals,
    incomeTotal12m: sumOver(incomeTotals),
    expenseTotal12m,
    // Concentração responde "onde mexer dá resultado": se 5 categorias são 70%
    // do gasto, cortar nas outras 30 é esforço sem efeito.
    expenseConcentration: expenseTotal12m > 0 ? top5 / expenseTotal12m : null,
    // Sazonalidade: os meses acima da média, do mais caro para o menos. É o que
    // permite planejar ANTES do mês caro chegar.
    expensivestMonths: (() => {
      const avg = expenseTotal12m / period.months.length;
      return period.months
        .filter((m) => (expenseTotals[m] ?? 0) > avg * 1.1)
        .sort((a, b) => (expenseTotals[b] ?? 0) - (expenseTotals[a] ?? 0))
        .slice(0, 3);
    })(),
  };
}

/* ────────────────────── Comportamento das metas no ano ──────────────────── */

export interface GoalMonthCell {
  key: string;
  meta: number;
  realizado: number;
  /** Sem meta definida naquele mês — célula cinza, fora do cálculo de aderência. */
  noMeta: boolean;
}

export interface GoalRow {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  meta12m: number;
  real12m: number;
  /** real12m − meta12m. Positivo = estourou. */
  deviation: number;
  deviationPct: number | null;
  monthsOver: number;
  monthsWithMeta: number;
  byMonth: GoalMonthCell[];
}

export interface GoalBehavior {
  rows: GoalRow[];
  meta12m: number;
  real12m: number;
  /** realizado ÷ meta no período (>100% = estourou). `null` sem meta nenhuma. */
  adherencePct: number | null;
  /** Meses cujo realizado total ficou dentro da meta total daquele mês. */
  monthsWithinBudget: number;
  monthsWithMeta: number;
  hasGoals: boolean;
}

/**
 * Metas no app são `Budget`: um limite por CATEGORIA e por MÊS. "Comportamento
 * no ano" é, então, a série dessas metas contra o realizado ao longo da janela.
 *
 * Categoria PAI agrega o gasto das subcategorias — é a fórmula da tela de Metas
 * e do dashboard mensal. (A do PDF não agrega; a divergência é conhecida e não
 * é replicada aqui.)
 */
export function computeGoalBehavior(
  transactions: Transaction[],
  categories: Category[],
  budgets: Budget[],
  period: AnnualPeriod
): GoalBehavior {
  const excludedIds = getExcludedFromTotalsIds(categories);
  const monthSet = new Set(period.months);
  const byId = new Map(categories.map((c) => [c.id, c]));

  // Gasto realizado por (categoria, mês) — sempre positivo; reembolso subtrai.
  const spent = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    if (!isExpenseAmount(t)) continue;
    const key = getMonthYear(accountingDate(t));
    if (!monthSet.has(key)) continue;
    const catId = t.categoryId || UNCATEGORIZED;
    let m = spent.get(catId);
    if (!m) {
      m = new Map();
      spent.set(catId, m);
    }
    m.set(key, (m.get(key) ?? 0) - t.amount);
  }

  const spentFor = (categoryId: string, monthKey: string): number => {
    const own = spent.get(categoryId)?.get(monthKey) ?? 0;
    const cat = byId.get(categoryId);
    if (cat && !cat.parentId) {
      let subs = 0;
      for (const c of categories) {
        if (c.parentId === categoryId) subs += spent.get(c.id)?.get(monthKey) ?? 0;
      }
      return own + subs;
    }
    return own;
  };

  // meta por (categoria, mês), só dentro da janela
  const metas = new Map<string, Map<string, number>>();
  for (const b of budgets) {
    if (!monthSet.has(b.monthYear)) continue;
    if (!byId.has(b.categoryId)) continue;
    let m = metas.get(b.categoryId);
    if (!m) {
      m = new Map();
      metas.set(b.categoryId, m);
    }
    m.set(b.monthYear, (m.get(b.monthYear) ?? 0) + b.limitAmount);
  }

  const rows: GoalRow[] = [];
  for (const [categoryId, monthMetas] of metas) {
    const cat = byId.get(categoryId)!;
    const byMonth: GoalMonthCell[] = period.months.map((key) => {
      const meta = monthMetas.get(key) ?? 0;
      return { key, meta, realizado: spentFor(categoryId, key), noMeta: meta <= 0 };
    });

    const meta12m = byMonth.reduce((s, c) => s + c.meta, 0);
    // Só os meses COM meta entram no realizado comparável — senão um mês sem
    // meta inflaria o realizado contra um denominador que não existe.
    const real12m = byMonth.reduce((s, c) => (c.noMeta ? s : s + c.realizado), 0);
    const deviation = real12m - meta12m;

    rows.push({
      categoryId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color || '#6e6d69',
      meta12m,
      real12m,
      deviation,
      deviationPct: meta12m > 0 ? (deviation / meta12m) * 100 : null,
      monthsOver: byMonth.filter((c) => !c.noMeta && c.realizado > c.meta).length,
      monthsWithMeta: byMonth.filter((c) => !c.noMeta).length,
      byMonth,
    });
  }

  // Pior desvio primeiro: quem precisa de atenção abre a tabela.
  rows.sort((a, b) => b.deviation - a.deviation || a.name.localeCompare(b.name, 'pt-BR'));

  // Totais do período: só categorias RAIZ, para não contar o mesmo gasto duas
  // vezes quando pai e filha têm meta (mesma regra do card de metas do mensal).
  const rootRows = rows.filter((r) => !byId.get(r.categoryId)?.parentId);
  const meta12m = rootRows.reduce((s, r) => s + r.meta12m, 0);
  const real12m = rootRows.reduce((s, r) => s + r.real12m, 0);

  let monthsWithMeta = 0;
  let monthsWithinBudget = 0;
  for (const key of period.months) {
    const metaMonth = rootRows.reduce((s, r) => {
      const cell = r.byMonth.find((c) => c.key === key);
      return cell && !cell.noMeta ? s + cell.meta : s;
    }, 0);
    if (metaMonth <= 0) continue;
    monthsWithMeta += 1;
    const realMonth = rootRows.reduce((s, r) => {
      const cell = r.byMonth.find((c) => c.key === key);
      return cell && !cell.noMeta ? s + cell.realizado : s;
    }, 0);
    if (realMonth <= metaMonth) monthsWithinBudget += 1;
  }

  return {
    rows,
    meta12m,
    real12m,
    adherencePct: meta12m > 0 ? (real12m / meta12m) * 100 : null,
    monthsWithinBudget,
    monthsWithMeta,
    hasGoals: rows.length > 0,
  };
}

/* ──────────────────────────── Projetos na janela ────────────────────────── */

export interface AnnualProjectRow {
  id: string;
  name: string;
  color: string;
  status: 'active' | 'archived';
  budget: number | null;
  /** Gasto POSITIVO no projeto inteiro e dentro da janela de 12M. */
  spentTotal: number;
  spent12m: number;
  startLabel: string;
  endLabel: string | null;
}

/**
 * Projetos que pertencem à janela. A cascata de pertinência é a mesma do card
 * mensal, estendida de um ano para o intervalo: `startDate ?? 1º ano com
 * lançamento ?? createdAt` até `endDate ?? (ativo ? ano corrente : último ano
 * com lançamento)`. Sem ela, projeto sem data some da tela — e nada valida
 * essas datas na escrita.
 */
export function computeAnnualProjects(
  projects: { id: string; name: string; color: string; status: 'active' | 'archived'; budget?: number | null; startDate: Date | null; endDate: Date | null; createdAt: Date }[],
  transactions: Transaction[],
  categories: Category[],
  period: AnnualPeriod
): AnnualProjectRow[] {
  const excludedIds = getExcludedFromTotalsIds(categories);
  const monthSet = new Set(period.months);
  const realYear = new Date().getFullYear();
  const firstYear = Number(period.months[0].slice(0, 4));
  const lastYear = Number(period.endKey.slice(0, 4));

  interface Agg {
    spentTotal: number;
    spent12m: number;
    years: Set<number>;
    touchesWindow: boolean;
  }
  const agg = new Map<string, Agg>();

  for (const t of transactions) {
    if (!t.projectId) continue;
    let e = agg.get(t.projectId);
    if (!e) {
      e = { spentTotal: 0, spent12m: 0, years: new Set(), touchesWindow: false };
      agg.set(t.projectId, e);
    }
    const ad = accountingDate(t);
    e.years.add(ad.getFullYear());
    const key = getMonthYear(ad);
    if (monthSet.has(key)) e.touchesWindow = true;

    if (!countsInTotals(t, excludedIds) || !isExpenseAmount(t)) continue;
    const value = -t.amount;
    e.spentTotal += value;
    if (monthSet.has(key)) e.spent12m += value;
  }

  const rows: AnnualProjectRow[] = [];
  for (const p of projects) {
    const a = agg.get(p.id);
    const txYears = a ? Array.from(a.years) : [];
    const minTxYear = txYears.length > 0 ? Math.min(...txYears) : null;
    const maxTxYear = txYears.length > 0 ? Math.max(...txYears) : null;

    const spanStart = p.startDate?.getFullYear() ?? minTxYear ?? p.createdAt?.getFullYear() ?? firstYear;
    const spanEnd =
      p.endDate?.getFullYear() ??
      (p.status === 'active' ? Math.max(realYear, maxTxYear ?? realYear) : maxTxYear ?? spanStart);

    const overlaps = spanStart <= lastYear && spanEnd >= firstYear;
    if (!overlaps && !a?.touchesWindow) continue;

    const start = p.startDate ?? (minTxYear ? new Date(minTxYear, 0, 1) : p.createdAt);
    rows.push({
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      budget: p.budget ?? null,
      spentTotal: a?.spentTotal ?? 0,
      spent12m: a?.spent12m ?? 0,
      startLabel: start ? `${MONTH_ABBR[start.getMonth()]}/${String(start.getFullYear()).slice(2)}` : '—',
      endLabel: p.endDate
        ? `${MONTH_ABBR[p.endDate.getMonth()]}/${String(p.endDate.getFullYear()).slice(2)}`
        : null,
    });
  }

  // Quem mais consumiu dinheiro na janela primeiro.
  rows.sort((a, b) => b.spent12m - a.spent12m || a.name.localeCompare(b.name, 'pt-BR'));
  return rows;
}

/* ─────────────────── Ano corrente: onde estou, onde termino ─────────────── */

export interface YearProjection {
  year: number;
  /** Meses do ano que já fecharam. 0 em janeiro. */
  closedMonths: number;
  /** Meses que faltam para o ano acabar, contando o que está em andamento. */
  remainingMonths: number;
  ytd: WindowTotals;
  /** O mesmo recorte de meses no ano passado — a única comparação honesta. */
  prevYtd: WindowTotals;
  /** Fechamento estimado do ano. */
  projected: { income: number; expense: number; result: number };
  /** Média mensal dos 12M que alimenta a projeção (a premissa, exibida na tela). */
  monthlyAvg: { income: number; expense: number; result: number };
  /**
   * Resultado mensal necessário nos meses restantes para o ano fechar em zero.
   * `null` quando o ano já está no azul — aí não há exigência a comunicar.
   */
  neededPerMonth: number | null;
  hasClosedMonth: boolean;
}

/**
 * A ponte entre as duas janelas: projeta o CICLO (ano corrente) usando a RÉGUA
 * (média dos 12 meses móveis). É o "para onde estou indo" — a metade que
 * nenhuma tela do app responde hoje.
 *
 * A premissa é deliberadamente simples e declarada na interface: "os meses que
 * faltam se parecem com a média dos últimos 12". Projeção mais esperta (por
 * sazonalidade do mês específico) erra mais e explica pior.
 */
export function computeYearProjection(stats: AnnualStats): YearProjection {
  const closedMonths = stats.period.ytdMonths.length;
  const remainingMonths = 12 - closedMonths;

  const monthlyAvg = {
    income: stats.m12.income / 12,
    expense: stats.m12.expense / 12,
    result: stats.m12.result / 12,
  };

  const projected = {
    income: stats.ytd.income + monthlyAvg.income * remainingMonths,
    expense: stats.ytd.expense + monthlyAvg.expense * remainingMonths,
    result: 0,
  };
  projected.result = projected.income - projected.expense;

  return {
    year: stats.period.year,
    closedMonths,
    remainingMonths,
    ytd: stats.ytd,
    prevYtd: stats.prevYtd,
    projected,
    monthlyAvg,
    neededPerMonth:
      stats.ytd.result < 0 && remainingMonths > 0
        ? -stats.ytd.result / remainingMonths
        : null,
    hasClosedMonth: closedMonths > 0,
  };
}

/* ──────────────────────── Compromissos já assumidos ─────────────────────── */

export interface CommitmentMonth {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface Commitments {
  months: CommitmentMonth[];
  total: number;
  /** Mês de maior compromisso — onde o caixa aperta. */
  peak: CommitmentMonth | null;
  /** Quanto do total vem de compras parceladas (o resto é lançamento agendado). */
  installmentTotal: number;
  hasData: boolean;
}

/**
 * Despesas que JÁ EXISTEM no banco com data futura — na prática as parcelas que
 * a importação de fatura grava adiantadas (`ImportModal`: cada parcela restante
 * vira um lançamento com a data do seu mês). Não é previsão: é dinheiro já
 * comprometido, e não aparece em nenhuma tela hoje.
 *
 * `from` é o primeiro mês da janela (exclusivo do mês corrente por padrão: o mês
 * em andamento já está sendo vivido, o que interessa aqui é o que vem depois).
 */
export function computeCommitments(
  transactions: Transaction[],
  categories: Category[],
  from: string = getMonthYearOffset(getMonthYear(), 1),
  horizon = 12
): Commitments {
  const excludedIds = getExcludedFromTotalsIds(categories);
  const keys: string[] = [];
  for (let i = 0; i < horizon; i++) keys.push(getMonthYearOffset(from, i));
  const index = new Map(keys.map((k, i) => [k, i]));

  const months: CommitmentMonth[] = keys.map((key) => ({
    key,
    label: shortMonthLabel(key),
    total: 0,
    count: 0,
  }));
  let installmentTotal = 0;

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    if (!isExpenseAmount(t)) continue;
    const i = index.get(getMonthYear(accountingDate(t)));
    if (i === undefined) continue;
    const value = -t.amount;
    months[i].total += value;
    months[i].count += 1;
    if (t.totalInstallments && t.totalInstallments > 1) installmentTotal += value;
  }

  const total = months.reduce((s, m) => s + m.total, 0);
  const peak = months.reduce<CommitmentMonth | null>(
    (acc, m) => (m.total > 0 && (acc === null || m.total > acc.total) ? m : acc),
    null
  );

  return { months, total, peak, installmentTotal, hasData: total > 0 };
}

/* ────────────────── Mês em andamento: onde ele deve fechar ──────────────── */

export interface MonthProjection {
  daysElapsed: number;
  daysInMonth: number;
  /** Fechamento estimado do mês. */
  income: number;
  expense: number;
  result: number;
  /** Média mensal dos 12 meses fechados — a premissa, exibida junto. */
  avgIncome: number;
  avgExpense: number;
}

/**
 * Estimativa de fechamento do mês CORRENTE. Hoje o dashboard simplesmente
 * desiste do delta num mês em andamento ("mês em andamento") — justamente na
 * informação mais útil de quem está vivendo o mês.
 *
 * A conta é "o que já rolou + o que costuma rolar no resto do mês", ancorada na
 * média dos 12 meses FECHADOS. Deliberadamente NÃO é run-rate (`gasto ÷ dias ×
 * 30`): no dia 3 isso multiplica ruído por dez, e as contas fixas caem em dias
 * específicos, não distribuídas. Antes do 5º dia nem isso se sustenta, e a
 * função devolve `null` — o rótulo honesto de "mês em andamento" fica.
 */
export function computeMonthProjection(
  transactions: Transaction[],
  categories: Category[],
  monthYear: string,
  now: Date = new Date()
): MonthProjection | null {
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (daysElapsed < 5 || daysElapsed >= daysInMonth) return null;

  const excludedIds = getExcludedFromTotalsIds(categories);
  const closed = new Set<string>();
  for (let i = 1; i <= 12; i++) closed.add(getMonthYearOffset(monthYear, -i));

  let realIncome = 0;
  let realExpense = 0;
  let pastIncome = 0;
  let pastExpense = 0;
  const monthsSeen = new Set<string>();

  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    const key = getMonthYear(accountingDate(t));
    if (key === monthYear) {
      if (isIncomeAmount(t)) realIncome += t.amount;
      else if (isExpenseAmount(t)) realExpense += -t.amount;
    } else if (closed.has(key)) {
      monthsSeen.add(key);
      if (isIncomeAmount(t)) pastIncome += t.amount;
      else if (isExpenseAmount(t)) pastExpense += -t.amount;
    }
  }

  // Sem histórico não há premissa — projetar sobre o nada seria inventar.
  if (monthsSeen.size === 0) return null;
  const avgIncome = pastIncome / monthsSeen.size;
  const avgExpense = pastExpense / monthsSeen.size;

  const remainingShare = (daysInMonth - daysElapsed) / daysInMonth;
  const income = realIncome + avgIncome * remainingShare;
  const expense = realExpense + avgExpense * remainingShare;

  return {
    daysElapsed,
    daysInMonth,
    income,
    expense,
    result: income - expense,
    avgIncome,
    avgExpense,
  };
}
