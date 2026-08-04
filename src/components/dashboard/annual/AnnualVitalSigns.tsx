import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatBRL0 } from '../../../lib/utils';
import { Group, Tile } from '../StatTile';
import type { TileDelta } from '../StatTile';
import type { AnnualStats } from '../../../lib/annualStats';

interface Props {
  stats: AnnualStats;
}

/**
 * Os indicadores da janela de 12 meses — a RÉGUA da tela anual. Reusa os mesmos
 * `Group`/`Tile` do dashboard mensal: um indicador que muda de aparência ao
 * trocar de face seria dois indicadores diferentes aos olhos de quem lê.
 *
 * O delta compara com os 12 meses ANTERIORES (janela contra janela do mesmo
 * tamanho), nunca com o ano do calendário — 12 meses móveis contra 8 meses
 * corridos é a comparação que faz alguém concluir errado sobre o próprio gasto.
 */
export function AnnualVitalSigns({ stats }: Props) {
  const { m12, prevM12, period } = stats;

  const pct = (curr: number, prev: number): number | null =>
    prev > 0 ? ((curr - prev) / prev) * 100 : null;

  const pctDelta = (
    value: number | null,
    higherIsBetter: boolean,
    context: string
  ): TileDelta | undefined => {
    if (value === null) return undefined;
    if (Math.abs(value) < 0.05) return { Icon: Minus, tone: 'text-ink-3', text: 'estável', context };
    const good = higherIsBetter ? value > 0 : value < 0;
    return {
      Icon: value > 0 ? TrendingUp : TrendingDown,
      tone: good ? 'text-positive' : 'text-negative',
      text: `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`,
      context,
    };
  };

  const vsPrev = 'vs 12M anteriores';
  const resultDelta = m12.result - prevM12.result;
  const savingsPp =
    m12.savingsRate !== null && prevM12.savingsRate !== null
      ? (m12.savingsRate - prevM12.savingsRate) * 100
      : null;

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[4fr_3fr] lg:gap-4">
      <Group label={`Últimos 12 meses · ${period.label}`}>
        <Tile
          label="Receitas do período"
          hint="Tudo que entrou nos 12 meses fechados. Transferências entre contas não contam."
          value={formatBRL0(m12.income)}
          valueTone="text-positive"
          delta={pctDelta(pct(m12.income, prevM12.income), true, vsPrev)}
        />
        <Tile
          label="Despesas do período"
          hint="Tudo que saiu nos 12 meses fechados. Reembolsos abatem o gasto em vez de virar receita."
          value={formatBRL0(m12.expense)}
          valueTone="text-negative"
          delta={pctDelta(pct(m12.expense, prevM12.expense), false, vsPrev)}
        />
        <Tile
          label="Resultado do período"
          hint="Receitas menos despesas nos 12 meses fechados — o que sobrou de fato."
          value={`${m12.result > 0 ? '+' : ''}${formatBRL0(m12.result)}`}
          valueTone={m12.result >= 0 ? 'text-positive' : 'text-negative'}
          delta={
            prevM12.monthsWithData === 0
              ? undefined
              : {
                  Icon: resultDelta > 0 ? TrendingUp : resultDelta < 0 ? TrendingDown : Minus,
                  tone:
                    Math.abs(resultDelta) < 1
                      ? 'text-ink-3'
                      : resultDelta > 0
                        ? 'text-positive'
                        : 'text-negative',
                  text: `${resultDelta > 0 ? '+' : ''}${formatBRL0(resultDelta)}`,
                  context: vsPrev,
                }
          }
        />
      </Group>

      <Group label="O padrão" cols={2}>
        <Tile
          label="Taxa de poupança"
          hint="Quanto de cada real que entrou sobrou, nos 12 meses fechados."
          value={
            m12.savingsRate === null
              ? '—'
              : `${(m12.savingsRate * 100).toFixed(1).replace('.', ',')}`
          }
          valueSuffix={m12.savingsRate === null ? undefined : '%'}
          valueTone={
            m12.savingsRate === null || m12.savingsRate >= 0 ? 'text-text-primary' : 'text-negative'
          }
          delta={
            savingsPp === null
              ? undefined
              : {
                  Icon: savingsPp > 0 ? TrendingUp : savingsPp < 0 ? TrendingDown : Minus,
                  tone:
                    Math.abs(savingsPp) < 0.1
                      ? 'text-ink-3'
                      : savingsPp > 0
                        ? 'text-positive'
                        : 'text-negative',
                  text: `${savingsPp > 0 ? '+' : ''}${savingsPp.toFixed(1).replace('.', ',')} p.p.`,
                  context: vsPrev,
                }
          }
        />
        <Tile
          label="Custo de vida"
          hint="Despesa média por mês nos 12 meses fechados — a régua de tudo nesta tela."
          value={formatBRL0(m12.expense / 12)}
          valueSuffix="/mês"
          delta={pctDelta(pct(m12.expense, prevM12.expense), false, vsPrev)}
        />
      </Group>
    </div>
  );
}
