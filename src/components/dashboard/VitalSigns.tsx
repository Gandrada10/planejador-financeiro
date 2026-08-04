import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';
import {
  formatBRL0,
  getMonthYear,
  getMonthYearOffset,
  countsInTotals,
  getExcludedFromTotalsIds,
  isIncomeAmount,
  isExpenseAmount,
  accountingDate,
} from '../../lib/utils';
import type { Transaction, Category } from '../../types';
import type { CostOfLivingData } from '../../lib/costOfLiving';
import { Group, Tile } from './StatTile';
import type { TileDelta } from './StatTile';
import type { MonthProjection } from '../../lib/annualStats';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  /** Mês selecionado ("2026-07") — origem da janela de comparação. */
  monthYear: string;
  /** Rótulo do mês selecionado, ex.: "junho de 2026". */
  monthLabel: string;
  /** Receitas do mês (positivo) e despesas do mês (negativo), como vêm do DashboardPage. */
  monthIncome: number;
  monthExpenses: number;
  monthBalance: number;
  /** Resultado médio dos últimos 12 meses (o mesmo da tabela de caixa). */
  avg12mResult: number;
  isMonthInProgress: boolean;
  costOfLiving: CostOfLivingData;
  /** Onde o mês em andamento deve fechar. `null` fora do mês corrente. */
  projection?: MonthProjection | null;
}

/**
 * Todos os indicadores do dashboard vivem aqui — não há segundo lugar com
 * número grande na tela. A divisão é por natureza da métrica:
 *
 *   grupo 1 — o MÊS selecionado: receitas, despesas, resultado. A conta
 *   inteira à vista (receitas − despesas = resultado), auto-verificável.
 *   grupo 2 — TENDÊNCIA: taxa de poupança e custo de vida, ambos na MESMA
 *   janela de 12 meses (assim um deriva do outro, e nenhum dos dois muda de
 *   significado ao longo do ano como fazia o acumulado).
 *
 * Metas NÃO tem tile: o agregado ("87%") repetia o card de Metas sem dizer
 * qual categoria furou — quem age precisa do card, o tile era eco. A leitura
 * acumulada do ano vive no card "O que puxou o ano".
 * Cada tile é rótulo → número-herói → delta com seta E sinal (nunca só cor).
 */
export function VitalSigns({
  transactions,
  categories,
  monthYear,
  monthLabel,
  monthIncome,
  monthExpenses,
  monthBalance,
  avg12mResult,
  isMonthInProgress,
  costOfLiving,
  projection,
}: Props) {
  const col = costOfLiving;

  const data = useMemo(() => {
    const excludedIds = getExcludedFromTotalsIds(categories);

    const byMonth = new Map<string, { inc: number; exp: number }>();
    for (const t of transactions) {
      if (!countsInTotals(t, excludedIds)) continue;
      const key = getMonthYear(accountingDate(t));
      let e = byMonth.get(key);
      if (!e) {
        e = { inc: 0, exp: 0 };
        byMonth.set(key, e);
      }
      if (isIncomeAmount(t)) e.inc += t.amount;
      // Reembolso é contra-despesa: abate o gasto do mês, não vira receita.
      else if (isExpenseAmount(t)) e.exp += -t.amount;
    }

    const window12 = (endKey: string) => {
      let inc = 0;
      let exp = 0;
      for (let i = 0; i < 12; i++) {
        const e = byMonth.get(getMonthYearOffset(endKey, -i));
        if (e) {
          inc += e.inc;
          exp += e.exp;
        }
      }
      return { inc, exp };
    };
    const rateOf = (w: { inc: number; exp: number }) => (w.inc > 0 ? (w.inc - w.exp) / w.inc : null);

    let currRate: number | null = null;
    let prevRate: number | null = null;

    // TAXA DE POUPANÇA é métrica de ESTADO: a janela termina no último mês
    // fechado e o inclui — é o que descreve como estou vivendo agora. A
    // comparação é contra os 12 meses ANTERIORES a essa janela, que não a
    // tocam, então aqui não há contaminação.
    if (col.endKey) {
      currRate = rateOf(window12(col.endKey));
      prevRate = rateOf(window12(getMonthYearOffset(col.endKey, -12)));
    }

    // RÉGUA DOS TILES DO MÊS: os 12 meses ANTERIORES ao selecionado. Uma base
    // de comparação não pode conter o valor que ela julga — a janela ia até o
    // próprio mês, então um mês atípico entrava no próprio denominador e
    // encolhia o desvio que deveria denunciá-lo.
    //
    // Divisor = meses COM lançamento na janela, mesma convenção do custo de
    // vida e da análise de categoria: um mês sem movimento é buraco de
    // histórico, não um zero legítimo.
    const baseEnd = getMonthYearOffset(monthYear, -1);
    const base = window12(baseEnd);
    let baseMonths = 0;
    for (let i = 0; i < 12; i++) if (byMonth.has(getMonthYearOffset(baseEnd, -i))) baseMonths += 1;
    const divisor = Math.max(baseMonths, 1);

    return {
      incomeAvg12m: base.inc > 0 ? base.inc / divisor : null,
      expenseAvg12m: base.exp > 0 ? base.exp / divisor : null,
      currRate,
      savingsDeltaPp: currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null,
    };
  }, [transactions, categories, monthYear, col.endKey]);

  const spentMonth = Math.abs(monthExpenses);

  // Num mês em andamento comparar com uma média mensal engana (mês pela metade
  // sempre parece "abaixo do normal") — os deltas do mês viram aviso.
  const pctVs = (value: number, base: number | null): number | null =>
    !isMonthInProgress && base !== null && base > 0 ? ((value - base) / base) * 100 : null;

  const incomeDelta = pctVs(monthIncome, data.incomeAvg12m);
  const spentDelta = pctVs(spentMonth, data.expenseAvg12m);
  const resultDelta = isMonthInProgress ? null : monthBalance - avg12mResult;

  const inProgress: TileDelta = {
    Icon: Minus,
    tone: 'text-ink-3',
    text: 'mês em andamento',
    context: '',
  };

  /**
   * No mês em andamento o delta contra a média não existe (mês pela metade
   * sempre parece "abaixo do normal"), mas o espaço não precisa ser desperdiçado
   * com um aviso mudo: mostra ONDE O MÊS DEVE FECHAR. Só a partir do 5º dia —
   * antes disso `computeMonthProjection` devolve null e o aviso volta.
   */
  const projected = (value: number, tone: string): TileDelta =>
    projection
      ? {
          Icon: ArrowRight,
          tone,
          text: `≈ ${formatBRL0(value)}`,
          context: `projeção · dia ${projection.daysElapsed}/${projection.daysInMonth}`,
        }
      : inProgress;

  /** Delta percentual com semântica: para despesa, subir é ruim. */
  const pctDelta = (pct: number | null, higherIsBetter: boolean, context: string): TileDelta | undefined => {
    if (pct === null) return isMonthInProgress ? inProgress : undefined;
    if (Math.abs(pct) < 0.05) return { Icon: Minus, tone: 'text-ink-3', text: 'no normal', context };
    const good = higherIsBetter ? pct > 0 : pct < 0;
    return {
      Icon: pct > 0 ? TrendingUp : TrendingDown,
      tone: good ? 'text-positive' : 'text-negative',
      text: `${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`,
      context,
    };
  };

  const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    // Em telas largas os dois grupos ficam LADO A LADO, cada um com seu
    // rótulo. As colunas usam a MESMA proporção (4fr/3fr) e o mesmo gap da
    // grade de cards abaixo: assim a fileira de indicadores fecha alinhada
    // com "Fluxo do dinheiro" e "O que puxou o ano", em vez de cortar no meio.
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[4fr_3fr] lg:gap-4">
      <Group label={monthTitle}>
        <Tile
          label="Receitas do mês"
          hint="Total de receitas do mês selecionado. O delta compara com a média dos 12 meses ANTERIORES a ele — a régua não inclui o mês que está sendo julgado."
          value={formatBRL0(monthIncome)}
          valueTone="text-positive"
          delta={
            isMonthInProgress
              ? projected(projection?.income ?? 0, 'text-ink-3')
              : pctDelta(incomeDelta, true, 'vs 12M anteriores')
          }
        />
        <Tile
          label="Despesas do mês"
          hint="Total de despesas do mês selecionado. O delta compara com a despesa média dos 12 meses ANTERIORES a ele. Não é o mesmo número do tile de custo de vida, que por ser retrato do momento inclui este mês."
          value={formatBRL0(spentMonth)}
          valueTone="text-negative"
          delta={
            isMonthInProgress
              ? projected(
                  projection?.expense ?? 0,
                  // A projeção da despesa TEM lado: fechar acima do custo de
                  // vida é o aviso que faz agir enquanto ainda dá tempo.
                  projection && col.endMA !== null && projection.expense > col.endMA
                    ? 'text-negative'
                    : 'text-ink-3'
                )
              : pctDelta(spentDelta, false, 'vs 12M anteriores')
          }
        />
        <Tile
          label="Resultado do mês"
          hint="Receitas menos despesas do mês. O delta compara com o resultado médio dos 12 meses ANTERIORES a ele."
          value={`${monthBalance > 0 ? '+' : ''}${formatBRL0(monthBalance)}`}
          valueTone={monthBalance >= 0 ? 'text-positive' : 'text-negative'}
          delta={
            resultDelta === null
              ? projected(
                  projection?.result ?? 0,
                  !projection
                    ? 'text-ink-3'
                    : projection.result >= 0
                      ? 'text-positive'
                      : 'text-negative'
                )
              : {
                  Icon: resultDelta > 0 ? TrendingUp : resultDelta < 0 ? TrendingDown : Minus,
                  tone:
                    Math.abs(resultDelta) < 1
                      ? 'text-ink-3'
                      : resultDelta > 0
                        ? 'text-positive'
                        : 'text-negative',
                  text: `${resultDelta > 0 ? '+' : ''}${formatBRL0(resultDelta)}`,
                  // A média deixa de ser referência abstrata e mostra o valor:
                  // é a régua do resultado do mês, e agora mora junto dele.
                  context: `vs 12M anteriores (${formatBRL0(avg12mResult)})`,
                }
          }
        />
      </Group>

      <Group label="Tendência · 12 meses" cols={2}>
        <Tile
          label="Taxa de poupança · 12 meses"
          hint={`Resultado ÷ receitas nos 12 meses encerrados em ${
            col.endLabel || 'último mês fechado'
          } — a mesma janela do custo de vida ao lado, então os dois fecham entre si (receita média = custo de vida ÷ (1 − taxa)). Negativa: no período você gastou mais do que ganhou (ex.: −24% = saíram R$ 124 para cada R$ 100 que entraram). A variação vem em PONTOS PERCENTUAIS (p.p.), não em %: de 10% para 12% são +2 p.p.; dizer "+20%" seria a outra leitura do mesmo fato, e com taxa negativa o percentual inverte o sinal da história.`}
          value={data.currRate !== null ? `${(data.currRate * 100).toFixed(1).replace('.', ',')}%` : '—'}
          delta={
            data.savingsDeltaPp !== null
              ? Math.abs(data.savingsDeltaPp) < 0.05
                ? { Icon: Minus, tone: 'text-ink-3', text: '0,0 p.p.', context: 'vs 12M anteriores' }
                : {
                    Icon: data.savingsDeltaPp > 0 ? TrendingUp : TrendingDown,
                    tone: data.savingsDeltaPp > 0 ? 'text-positive' : 'text-negative',
                    text: `${data.savingsDeltaPp > 0 ? '+' : '−'}${Math.abs(data.savingsDeltaPp)
                      .toFixed(1)
                      .replace('.', ',')} p.p.`,
                    context: 'vs 12M anteriores',
                  }
              : undefined
          }
        />
        <Tile
          label="Custo de vida · 12 meses"
          hint={
            col.endMA !== null
              ? `Média das despesas dos 12 meses encerrados em ${col.endLabel} — o mês em andamento fica de fora.${
                  col.deltaAbs !== null && col.base !== null
                    ? ` Aumento de ${formatBRL0(col.deltaAbs)}/mês desde ${col.base.label}, quando era ${formatBRL0(col.base.ma)}/mês.`
                    : ''
                }`
              : 'Média das despesas dos últimos 12 meses.'
          }
          value={col.endMA !== null ? formatBRL0(col.endMA) : '—'}
          valueSuffix={col.endMA !== null ? '/mês' : undefined}
          delta={
            col.deltaPct !== null && col.base !== null
              ? {
                  Icon: col.deltaPct > 0 ? TrendingUp : col.deltaPct < 0 ? TrendingDown : Minus,
                  // Custo de vida subindo é RUIM.
                  tone:
                    Math.abs(col.deltaPct) < 0.05
                      ? 'text-ink-3'
                      : col.deltaPct > 0
                        ? 'text-negative'
                        : 'text-positive',
                  text: `${col.deltaPct > 0 ? '+' : ''}${col.deltaPct.toFixed(1).replace('.', ',')}%`,
                  // "desde jan/26", não "em 6 meses": o valor acima é uma
                  // média de 12 MESES, e um chip com outro número de meses
                  // logo abaixo lia como se a média fosse desse período. O
                  // que a base marca é um PONTO no tempo, não uma janela.
                  context: `desde ${col.base.label}`,
                }
              : col.endPartialMonths !== null
                ? {
                    Icon: Minus,
                    tone: 'text-ink-3',
                    text: `${col.endPartialMonths} ${col.endPartialMonths === 1 ? 'mês' : 'meses'}`,
                    context: 'de histórico',
                  }
                : undefined
          }
        />
      </Group>
    </div>
  );
}

