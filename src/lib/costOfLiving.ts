import {
  countsInTotals,
  getExcludedFromTotalsIds,
  isExpenseAmount,
  accountingDate,
  getMonthYear,
  getMonthYearOffset,
} from './utils';
import type { Transaction, Category } from '../types';

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface CostOfLivingPoint {
  key: string; // "YYYY-MM"
  label: string; // "jul/24"
  expense: number;
  /** Média móvel de 12M encerrada neste mês; null quando a janela não está completa. */
  ma: number | null;
}

export interface CostOfLivingData {
  points: CostOfLivingPoint[];
  /** Último mês COMPLETO (o mês em andamento fica de fora). */
  endKey: string | null;
  endLabel: string;
  /** Média vigente. Cheia (12 meses) ou, sem janela completa, parcial. */
  endMA: number | null;
  /** Nº de meses da média quando parcial; null quando a janela de 12 está cheia. */
  endPartialMonths: number | null;
  /**
   * Base de comparação da tendência: a mesma média móvel 12 meses atrás
   * ('12m') ou, sem histórico para isso, o primeiro ponto cheio da série
   * ('since' + label). null = histórico curto demais para tendência.
   */
  base: { ma: number; kind: '12m' | 'since'; label: string } | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  worst: { label: string; value: number } | null;
  hasData: boolean;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_ABBR[Number(m) - 1]}/${y.slice(2)}`;
}

/**
 * Custo de vida como TRAJETÓRIA: média móvel de 12 meses da despesa mensal,
 * recalculada mês a mês. Substitui a comparação assimétrica antiga (meses
 * completos do ano atual vs ano anterior inteiro): aqui toda comparação é
 * 12 meses vs 12 meses por construção.
 *
 * A janela do gráfico são os `windowMonths` últimos meses encerrados no último
 * mês COMPLETO (o mês em andamento não entra — diluiria a média com um mês
 * parcial). A linha só existe onde a janela de 12 meses cabe inteira dentro do
 * histórico; antes disso ficam só as barras mensais.
 */
export function computeCostOfLiving(
  transactions: Transaction[],
  categories: Category[],
  monthYear: string,
  isMonthInProgress: boolean,
  windowMonths = 24,
): CostOfLivingData {
  const excludedIds = getExcludedFromTotalsIds(categories);

  // Despesa total (positiva) por mês, sobre TODO o histórico — a média móvel
  // do primeiro mês do gráfico alcança até 35 meses para trás.
  const expenseByMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!countsInTotals(t, excludedIds)) continue;
    if (!isExpenseAmount(t)) continue;
    const key = getMonthYear(accountingDate(t));
    // Despesa como positivo; reembolso (positivo) reduz o gasto do mês.
    expenseByMonth.set(key, (expenseByMonth.get(key) || 0) - t.amount);
  }

  const endKey = isMonthInProgress ? getMonthYearOffset(monthYear, -1) : monthYear;
  const firstDataKey = expenseByMonth.size > 0 ? [...expenseByMonth.keys()].sort()[0] : null;

  const empty: CostOfLivingData = {
    points: [],
    endKey: null,
    endLabel: '',
    endMA: null,
    endPartialMonths: null,
    base: null,
    deltaAbs: null,
    deltaPct: null,
    worst: null,
    hasData: false,
  };
  if (!firstDataKey || firstDataKey > endKey) return empty;

  const maAt = (key: string): number | null => {
    const windowStart = getMonthYearOffset(key, -11);
    if (windowStart < firstDataKey) return null;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += expenseByMonth.get(getMonthYearOffset(key, -i)) || 0;
    return sum / 12;
  };

  const points: CostOfLivingPoint[] = [];
  for (let i = windowMonths - 1; i >= 0; i--) {
    const key = getMonthYearOffset(endKey, -i);
    points.push({
      key,
      label: monthLabel(key),
      expense: expenseByMonth.get(key) || 0,
      ma: maAt(key),
    });
  }

  // Média vigente: cheia quando a janela de 12 cabe; senão, média parcial dos
  // meses COM dado dentro da janela (transparente via endPartialMonths).
  let endMA = maAt(endKey);
  let endPartialMonths: number | null = null;
  if (endMA === null) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 12; i++) {
      const v = expenseByMonth.get(getMonthYearOffset(endKey, -i));
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    if (n > 0) {
      endMA = sum / n;
      endPartialMonths = n;
    }
  }

  // Base da tendência: mesma média 12 meses atrás; sem isso, o primeiro ponto
  // cheio da série visível (também uma janela de 12 — comparação honesta).
  let base: CostOfLivingData['base'] = null;
  if (endPartialMonths === null) {
    const yearAgoKey = getMonthYearOffset(endKey, -12);
    const yearAgoMA = maAt(yearAgoKey);
    if (yearAgoMA !== null) {
      base = { ma: yearAgoMA, kind: '12m', label: monthLabel(yearAgoKey) };
    } else {
      const firstFull = points.find((p) => p.ma !== null);
      if (firstFull && firstFull.key !== endKey && firstFull.ma !== null) {
        base = { ma: firstFull.ma, kind: 'since', label: firstFull.label };
      }
    }
  }

  const deltaAbs = endMA !== null && base !== null ? endMA - base.ma : null;
  const deltaPct = deltaAbs !== null && base !== null && base.ma > 0 ? (deltaAbs / base.ma) * 100 : null;

  let worst: CostOfLivingData['worst'] = null;
  for (const p of points) {
    if (p.expense > 0 && (worst === null || p.expense > worst.value)) {
      worst = { label: p.label, value: p.expense };
    }
  }

  return {
    points,
    endKey,
    endLabel: monthLabel(endKey),
    endMA,
    endPartialMonths,
    base,
    deltaAbs,
    deltaPct,
    worst,
    hasData: endMA !== null,
  };
}
