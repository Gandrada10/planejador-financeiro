import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
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

interface Props {
  transactions: Transaction[];
  categories: Category[];
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
  monthLabel,
  monthIncome,
  monthExpenses,
  monthBalance,
  avg12mResult,
  isMonthInProgress,
  costOfLiving,
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
    let incomeAvg12m: number | null = null;

    if (col.endKey) {
      const curr = window12(col.endKey);
      currRate = rateOf(curr);
      prevRate = rateOf(window12(getMonthYearOffset(col.endKey, -12)));
      // Mesmo divisor do custo de vida (12 na janela cheia; nº de meses com
      // dado na parcial) — sem isso os dois números do grupo não fecham.
      const divisor = col.endPartialMonths ?? 12;
      if (curr.inc > 0) incomeAvg12m = curr.inc / divisor;
    }

    return {
      incomeAvg12m,
      currRate,
      savingsDeltaPp: currRate !== null && prevRate !== null ? (currRate - prevRate) * 100 : null,
    };
  }, [transactions, categories, col.endKey, col.endPartialMonths]);

  const spentMonth = Math.abs(monthExpenses);

  // Num mês em andamento comparar com uma média mensal engana (mês pela metade
  // sempre parece "abaixo do normal") — os deltas do mês viram aviso.
  const pctVs = (value: number, base: number | null): number | null =>
    !isMonthInProgress && base !== null && base > 0 ? ((value - base) / base) * 100 : null;

  const incomeDelta = pctVs(monthIncome, data.incomeAvg12m);
  const spentDelta = pctVs(spentMonth, col.endMA);
  const resultDelta = isMonthInProgress ? null : monthBalance - avg12mResult;

  const inProgress: TileDelta = {
    Icon: Minus,
    tone: 'text-ink-3',
    text: 'mês em andamento',
    context: '',
  };

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
          hint="Total de receitas do mês selecionado. O delta compara com a sua receita média dos últimos 12 meses."
          value={formatBRL0(monthIncome)}
          valueTone="text-positive"
          delta={pctDelta(incomeDelta, true, 'vs média 12M')}
        />
        <Tile
          label="Despesas do mês"
          hint="Total de despesas do mês selecionado. O delta compara com o seu custo de vida (média móvel de 12 meses)."
          value={formatBRL0(spentMonth)}
          valueTone="text-negative"
          delta={pctDelta(spentDelta, false, 'vs custo de vida')}
        />
        <Tile
          label="Resultado do mês"
          hint="Receitas menos despesas do mês. O delta compara com o seu resultado médio dos últimos 12 meses."
          value={`${monthBalance > 0 ? '+' : ''}${formatBRL0(monthBalance)}`}
          valueTone={monthBalance >= 0 ? 'text-positive' : 'text-negative'}
          delta={
            resultDelta === null
              ? inProgress
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
                  context: `vs média 12M (${formatBRL0(avg12mResult)})`,
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
                  context: `em ${col.base.spanMonths} meses`,
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

/**
 * No grupo de 3 (o mês), o celular usa 2 colunas com o TERCEIRO tile na linha
 * inteira — empilhar deixaria a tela com quase 2000px de rolagem, e o terceiro
 * é justamente a conclusão (Resultado), então ganhar largura é hierarquia.
 * O grupo de tendência tem 2 tiles e vive em 2 colunas em qualquer largura.
 */
function Group({ label, cols = 3, children }: { label: string; cols?: 2 | 3; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 mb-1.5 px-0.5">
        {label}
      </p>
      <div
        className={
          cols === 3
            ? 'grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 [&>*:nth-child(3)]:col-span-2 sm:[&>*:nth-child(3)]:col-span-1'
            : 'grid grid-cols-2 gap-2 sm:gap-3'
        }
      >
        {children}
      </div>
    </div>
  );
}

interface TileDelta {
  Icon: typeof TrendingUp;
  tone: string;
  text: string;
  context: string;
}

function Tile({
  label,
  hint,
  value,
  valueSuffix,
  valueTone = 'text-text-primary',
  delta,
}: {
  label: string;
  hint?: string;
  value: string;
  valueSuffix?: string;
  valueTone?: string;
  delta?: TileDelta;
}) {
  return (
    <div
      className="bg-bg-card border border-border rounded-card px-3 py-3 sm:px-4 sm:py-3.5 flex flex-col gap-1 sm:gap-1.5 min-w-0"
      title={hint}
    >
      {/* Quebra em 2 linhas em vez de truncar: em 2 colunas no celular,
          "TAXA DE POUPANÇA · ANO" não cabe numa linha e virava "TAXA DE ...". */}
      <span className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">{label}</span>
      {/* 21px no celular, 24px no desktop. O token text-kpi (28px) é para UM
          número-herói por tela — repetido em seis tiles ficava desproporcional. */}
      <span className={`text-[21px] sm:text-[24px] font-bold tracking-tight tnum leading-none truncate ${valueTone}`}>
        {value}
        {valueSuffix && <span className="text-caption sm:text-body font-medium text-text-secondary tracking-normal">{valueSuffix}</span>}
      </span>
      {delta ? (
        <span className={`flex items-baseline gap-x-1.5 flex-wrap text-caption font-semibold tnum ${delta.tone} min-w-0`}>
          <delta.Icon size={12} className="flex-shrink-0 self-center" />
          <span>{delta.text}</span>
          {/* Quebra em vez de truncar: com o valor da média junto, o contexto
              não cabe numa linha em 2 colunas de celular. */}
          {delta.context && <span className="text-ink-3 font-normal">{delta.context}</span>}
        </span>
      ) : (
        <span className="text-caption text-ink-3">—</span>
      )}
    </div>
  );
}
