import { TrendingUp, TrendingDown, Minus, Flag } from 'lucide-react';
import { formatBRL0 } from '../../../lib/utils';
import type { YearProjection } from '../../../lib/annualStats';

interface Props {
  projection: YearProjection;
  ytdLabel: string;
}

/**
 * O ÚNICO lugar da tela anual com números de ano corrente — e de propósito.
 *
 * Doze meses móveis são a régua (sempre contêm um Natal, um IPVA, um 13º), mas
 * o ano do calendário é o ciclo que se fecha: é onde as metas vivem. Repetir
 * as duas janelas em todos os cards dobraria a densidade e minaria a confiança
 * ("por que há dois valores de Receitas nesta tela?"). Então o ano corrente
 * aparece uma vez, e não como cópia: como PLACAR — onde estou, onde termino no
 * ritmo atual, e o que falta para virar o jogo.
 *
 * A projeção usa a régua de 12M para estimar os meses que faltam. A premissa
 * fica escrita na tela: número projetado sem premissa vira promessa.
 */
export function YearProgressCard({ projection: p, ytdLabel }: Props) {
  if (!p.hasClosedMonth) {
    return (
      <div className="bg-bg-card border border-border rounded-card p-4 space-y-1">
        <Header year={p.year} subtitle={`${p.year} ainda não tem mês fechado`} />
        <p className="text-body text-text-secondary leading-snug pt-1">
          O ano mal começou. Quando janeiro fechar, este card passa a mostrar o realizado, a
          projeção de fechamento e a comparação com {p.year - 1}. Até lá, a leitura que vale é a
          dos 12 meses acima.
        </p>
      </div>
    );
  }

  const yoy = (curr: number, prev: number): number | null =>
    prev > 0 ? ((curr - prev) / prev) * 100 : null;

  const projectedTone = p.projected.result >= 0 ? 'text-positive' : 'text-negative';

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <Header
        year={p.year}
        subtitle={`${ytdLabel} · ${p.closedMonths} ${p.closedMonths === 1 ? 'mês fechado' : 'meses fechados'}, faltam ${p.remainingMonths}`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cell
          label="Receitas no ano"
          value={formatBRL0(p.ytd.income)}
          tone="text-positive"
          foot={<Yoy pct={yoy(p.ytd.income, p.prevYtd.income)} higherIsBetter year={p.year - 1} />}
        />
        <Cell
          label="Despesas no ano"
          value={formatBRL0(p.ytd.expense)}
          tone="text-negative"
          foot={
            <Yoy pct={yoy(p.ytd.expense, p.prevYtd.expense)} higherIsBetter={false} year={p.year - 1} />
          }
        />
        <Cell
          label="Resultado no ano"
          value={`${p.ytd.result > 0 ? '+' : ''}${formatBRL0(p.ytd.result)}`}
          tone={p.ytd.result >= 0 ? 'text-positive' : 'text-negative'}
          foot={
            p.prevYtd.monthsWithData > 0 ? (
              <span className="text-caption text-ink-3">
                {p.year - 1}:{' '}
                <span className="tnum">
                  {p.prevYtd.result > 0 ? '+' : ''}
                  {formatBRL0(p.prevYtd.result)}
                </span>
              </span>
            ) : null
          }
        />
        {/* A projeção fica no mesmo tamanho dos outros, não maior: é estimativa,
            e estimativa com corpo de número-herói vira promessa. */}
        <Cell
          label={`Fecha ${p.year} em`}
          value={`${p.projected.result > 0 ? '+' : ''}${formatBRL0(p.projected.result)}`}
          tone={projectedTone}
          foot={
            <span className="text-caption text-ink-3">
              estimativa · {formatBRL0(p.projected.income)} − {formatBRL0(p.projected.expense)}
            </span>
          }
        />
      </div>

      {/* A premissa e a conclusão, em text-body: são as duas frases que
          respondem "e daí?" — a 11px muda ninguém lê. */}
      <div className="pt-2 border-t border-border space-y-1 text-body text-text-secondary leading-snug">
        <p>
          A projeção assume os {p.remainingMonths}{' '}
          {p.remainingMonths === 1 ? 'mês restante' : 'meses restantes'} na média dos últimos 12:{' '}
          <span className="tnum">{formatBRL0(p.monthlyAvg.income)}</span> de receita e{' '}
          <span className="tnum">{formatBRL0(p.monthlyAvg.expense)}</span> de despesa por mês.
        </p>
        {p.neededPerMonth !== null ? (
          <p>
            Para {p.year} fechar no zero, os meses que faltam precisam somar{' '}
            <span className="tnum font-semibold text-status-warn">
              {formatBRL0(p.neededPerMonth)}
            </span>{' '}
            de resultado por mês — contra{' '}
            <span className="tnum">{formatBRL0(p.monthlyAvg.result)}</span> que é o seu normal.
          </p>
        ) : p.projected.result >= 0 ? (
          <p>
            No ritmo atual o ano fecha no azul, com{' '}
            <span className="tnum font-semibold text-positive">
              {formatBRL0(p.projected.result)}
            </span>{' '}
            de sobra.
          </p>
        ) : (
          <p>
            O ano está no azul até aqui, mas a média dos últimos 12 meses o leva ao vermelho até
            dezembro — o que falta gastar pesa mais do que o que já sobrou.
          </p>
        )}
      </div>
    </div>
  );
}

function Header({ year, subtitle }: { year: number; subtitle: string }) {
  return (
    <div className="flex items-start gap-2">
      <Flag size={14} className="text-ink-3 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <h3 className="text-title font-semibold text-text-primary">Ano corrente · {year}</h3>
        <p className="text-caption text-ink-3 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
  foot,
}: {
  label: string;
  value: string;
  tone: string;
  foot: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">
        {label}
      </p>
      <p className={`text-[19px] font-bold tracking-tight tnum leading-none truncate ${tone}`}>
        {value}
      </p>
      {foot}
    </div>
  );
}

function Yoy({
  pct,
  higherIsBetter,
  year,
}: {
  pct: number | null;
  higherIsBetter: boolean;
  year: number;
}) {
  if (pct === null) return <span className="text-caption text-ink-3">sem base em {year}</span>;
  const flat = Math.abs(pct) < 0.05;
  const good = higherIsBetter ? pct > 0 : pct < 0;
  const Icon = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={`flex items-center gap-1 text-caption font-semibold tnum ${
        flat ? 'text-ink-3' : good ? 'text-positive' : 'text-negative'
      }`}
    >
      <Icon size={12} className="flex-shrink-0" />
      {pct > 0 ? '+' : ''}
      {pct.toFixed(1).replace('.', ',')}%
      <span className="text-ink-3 font-normal">vs {year}</span>
    </span>
  );
}
