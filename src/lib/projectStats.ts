/**
 * projectStats — a estatística de um projeto, num lugar só.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────
 * O mesmo cálculo estava escrito TRÊS vezes, e as três divergiam no que
 * consideravam: `ProjectsPage` (card da aba Projetos), `ProjectsPanel`
 * (painel do dashboard, com recortes de ano/mês) e `computeProjects` no
 * `computeReportData` (PDF). Três respostas possíveis para "quanto custou a
 * viagem" é uma a mais do que o aceitável num app de finanças.
 *
 * ── As regras que NÃO podem ser reinventadas ───────────────────────────────
 * Toda a semântica de "o que conta" já vive em `src/lib/utils.ts` e é
 * reusada aqui, nunca reimplementada:
 *   - `countsInTotals`   — transferência (compra de moeda, pagamento de
 *                          fatura, PIX entre contas próprias) fica FORA de
 *                          receita e despesa; é dinheiro trocando de bolso.
 *   - `isIncomeAmount` / `isExpenseAmount` — reembolso positivo não é
 *                          receita: é contra-despesa, e abate o gasto.
 *   - `accountingDate`   — reembolso vinculado é atribuído ao mês da DESPESA
 *                          que abate, não ao mês em que o dinheiro entrou.
 *
 * ── Moeda estrangeira ──────────────────────────────────────────────────────
 * `byCurrency` e o `fx` de cada categoria somam `amountFx` — os satélites
 * descritos em `Transaction`. Eles NUNCA se misturam com os totais em reais:
 * são duas colunas paralelas da mesma tabela, não duas parcelas de uma soma.
 * É o que permite ler "a viagem custou R$ 34.031,56 / € 5.567,75" sem que
 * nenhum número em reais do resto do app mude de valor.
 */

import type { Transaction, Category } from '../types';
import {
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
  getMonthYear,
} from './utils';

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  /** Gasto em reais, POSITIVO (magnitude) — para ordenar e desenhar barra. */
  brl: number;
  /** Mesmo gasto na moeda estrangeira, quando houver. Positivo. */
  fx: { currency: string; amount: number }[];
  count: number;
  /** Fatia sobre a despesa total do projeto, 0–1. */
  share: number;
}

export interface MonthSlice {
  monthYear: string;
  /** Despesa do mês, POSITIVA. */
  brl: number;
  count: number;
}

export interface CurrencyTotal {
  currency: string;
  /** Gasto na moeda, POSITIVO. */
  amount: number;
  count: number;
  /** Taxa média efetiva do que foi gasto nessa moeda (BRL por unidade). */
  averageRate: number | null;
  /** Quanto do gasto em reais do projeto tem lastro em moeda. Comparar com
   *  `expense` revela o que foi pago em reais (passagem comprada no Brasil,
   *  por exemplo) e não deveria aparecer no total em euro. */
  brl: number;
}

export interface ProjectStats {
  /** TODOS os lançamentos do projeto, inclusive os fora-dos-totais. */
  count: number;
  /** Lançamentos que entram nos totais (sem transferências). */
  countedCount: number;
  /** Receitas em reais, positivo. */
  income: number;
  /** Despesas em reais, NEGATIVO (reembolso vinculado já abatido). */
  expense: number;
  /** `income + expense`. */
  balance: number;
  byCategory: CategorySlice[];
  byMonth: MonthSlice[];
  byCurrency: CurrencyTotal[];
  /** Primeiro e último lançamento — o período REAL, que costuma diferir das
   *  datas cadastradas no projeto (quase sempre em branco). */
  firstDate: Date | null;
  lastDate: Date | null;
}

const EMPTY: ProjectStats = {
  count: 0,
  countedCount: 0,
  income: 0,
  expense: 0,
  balance: 0,
  byCategory: [],
  byMonth: [],
  byCurrency: [],
  firstDate: null,
  lastDate: null,
};

/**
 * Calcula tudo num passe só sobre os lançamentos JÁ FILTRADOS por projeto.
 *
 * Recebe a lista pronta em vez do `projectId` para o chamador que precisa de
 * vários projetos (a lista da aba, o painel do dashboard) poder agrupar uma
 * vez e não varrer a base inteira por projeto — com centenas de lançamentos
 * e uma dezena de projetos isso é a diferença entre um passe e dez.
 */
export function computeProjectStats(
  projectTransactions: Transaction[],
  categories: Category[]
): ProjectStats {
  if (projectTransactions.length === 0) return EMPTY;

  // Set pré-computado: `countsInTotals` aceita o array, mas aí refaria o Set
  // a cada transação — em projeto de viagem são centenas.
  const excluded = getExcludedFromTotalsIds(categories);
  const catById = new Map(categories.map((c) => [c.id, c]));

  let income = 0;
  let expense = 0;
  let countedCount = 0;
  let firstDate: Date | null = null;
  let lastDate: Date | null = null;

  const cats = new Map<string, { brl: number; count: number; fx: Map<string, number> }>();
  const months = new Map<string, { brl: number; count: number }>();
  const currencies = new Map<string, { amount: number; count: number; brl: number }>();

  for (const t of projectTransactions) {
    // O período usa a data de EXIBIÇÃO (`date`), não a contábil: o usuário
    // quer saber quando a viagem aconteceu, e um reembolso recebido depois
    // não estica o período da viagem para trás nem para frente.
    if (!firstDate || t.date < firstDate) firstDate = t.date;
    if (!lastDate || t.date > lastDate) lastDate = t.date;

    // Transferência não é gasto nem ganho — nem em reais, nem em moeda. A
    // compra de euro cai aqui, e é exatamente o que impede o total do
    // projeto de contar a viagem duas vezes.
    if (!countsInTotals(t, excluded)) continue;
    countedCount++;

    if (isIncomeAmount(t)) {
      income += t.amount;
      continue;
    }
    if (!isExpenseAmount(t)) continue; // valor zero: não entra em nenhum lado

    expense += t.amount; // assinado: reembolso positivo abate
    const magnitude = -t.amount; // positivo p/ despesa, negativo p/ reembolso

    const key = t.categoryId ?? '';
    const slice = cats.get(key) ?? { brl: 0, count: 0, fx: new Map<string, number>() };
    slice.brl += magnitude;
    slice.count += 1;

    if (t.currencyFx && t.amountFx != null) {
      const cur = t.currencyFx.toUpperCase();
      const fxMagnitude = -t.amountFx;
      slice.fx.set(cur, (slice.fx.get(cur) ?? 0) + fxMagnitude);
      const tot = currencies.get(cur) ?? { amount: 0, count: 0, brl: 0 };
      tot.amount += fxMagnitude;
      tot.count += 1;
      tot.brl += magnitude;
      currencies.set(cur, tot);
    }
    cats.set(key, slice);

    // Mês pela data CONTÁBIL: reembolso vinculado pertence ao mês da despesa
    // que abate, senão a curva do projeto mostraria um vale onde não houve.
    const my = getMonthYear(accountingDate(t));
    const m = months.get(my) ?? { brl: 0, count: 0 };
    m.brl += magnitude;
    m.count += 1;
    months.set(my, m);
  }

  const totalExpense = -expense; // positivo

  const byCategory: CategorySlice[] = [...cats.entries()]
    .map(([id, slice]) => {
      const cat = id ? catById.get(id) : undefined;
      return {
        categoryId: id || null,
        name: cat?.name ?? 'Sem categoria',
        color: cat?.color ?? '#64748b',
        icon: cat?.icon ?? 'circle-help',
        brl: slice.brl,
        fx: [...slice.fx.entries()].map(([currency, amount]) => ({ currency, amount })),
        count: slice.count,
        share: totalExpense > 0 ? slice.brl / totalExpense : 0,
      };
    })
    .sort((a, b) => b.brl - a.brl);

  const byMonth: MonthSlice[] = [...months.entries()]
    .map(([monthYear, m]) => ({ monthYear, brl: m.brl, count: m.count }))
    .sort((a, b) => a.monthYear.localeCompare(b.monthYear));

  const byCurrency: CurrencyTotal[] = [...currencies.entries()]
    .map(([currency, c]) => ({
      currency,
      amount: c.amount,
      count: c.count,
      brl: c.brl,
      averageRate: c.amount !== 0 ? c.brl / c.amount : null,
    }))
    .sort((a, b) => b.brl - a.brl);

  return {
    count: projectTransactions.length,
    countedCount,
    income,
    expense,
    balance: income + expense,
    byCategory,
    byMonth,
    byCurrency,
    firstDate,
    lastDate,
  };
}

/**
 * Agrupa a base inteira por `projectId` num passe. Quem precisa de vários
 * projetos chama isto e depois `computeProjectStats` por projeto, em vez de
 * filtrar a lista completa uma vez por projeto.
 */
export function groupByProject(transactions: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.projectId) continue;
    const list = map.get(t.projectId);
    if (list) list.push(t);
    else map.set(t.projectId, [t]);
  }
  return map;
}
