import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { formatBRL0, formatBRL } from '../../../lib/utils';
import { shortMonthLabel } from '../../../lib/annualStats';
import type { GoalBehavior, GoalRow, AnnualPeriod } from '../../../lib/annualStats';

interface Props {
  goals: GoalBehavior;
  period: AnnualPeriod;
  className?: string;
}

/**
 * Como as metas se COMPORTARAM ao longo do ano — não o retrato de um mês, que é
 * o que a tela de orçamento já dá. A pergunta aqui é outra: "esta meta é
 * realista?". Uma categoria que estoura em 9 de 12 meses não tem um problema de
 * gasto, tem um problema de meta.
 *
 * Ordenado pelo PIOR DESVIO primeiro: quem precisa de atenção abre a tabela, em
 * vez de ficar no rodapé atrás das categorias que estão indo bem.
 */
export function AnnualGoalsPanel({ goals, period, className = '' }: Props) {
  if (!goals.hasGoals) {
    return (
      <div className={`bg-bg-card border border-border rounded-card p-4 space-y-2 ${className}`}>
        <Header period={period} />
        <p className="text-body text-text-secondary leading-snug">
          Nenhuma meta definida nos últimos 12 meses.{' '}
          <Link to="/orcamento" className="text-accent hover:underline">
            Definir metas
          </Link>{' '}
          transforma esta tela num acompanhamento de plano, não só de histórico.
        </p>
      </div>
    );
  }

  const over = goals.adherencePct !== null && goals.adherencePct > 100;

  return (
    <div className={`bg-bg-card border border-border rounded-card p-4 space-y-3 ${className}`}>
      <Header period={period} />

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Meta do período"
          value={formatBRL0(goals.meta12m)}
          foot={`realizado ${formatBRL0(goals.real12m)}`}
        />
        <Stat
          label="Aderência"
          value={goals.adherencePct === null ? '—' : `${goals.adherencePct.toFixed(0)}%`}
          tone={over ? 'text-status-over' : 'text-status-ok'}
          foot={over ? 'acima do planejado' : 'dentro do planejado'}
        />
        <Stat
          label="Meses no alvo"
          value={`${goals.monthsWithinBudget}/${goals.monthsWithMeta}`}
          tone={
            goals.monthsWithMeta > 0 && goals.monthsWithinBudget / goals.monthsWithMeta >= 0.5
              ? 'text-status-ok'
              : 'text-status-warn'
          }
          foot="fecharam dentro da meta"
        />
      </div>

      <div className="scroll-x">
        <table className="w-full min-w-[520px] text-body">
          <thead>
            <tr className="text-caption uppercase tracking-wider text-ink-3">
              <th className="text-left font-semibold py-1.5 pr-2">Categoria</th>
              <th className="text-left font-semibold py-1.5 px-2 w-[100px]">Ao longo do ano</th>
              <th className="text-right font-semibold py-1.5 px-2">Meta</th>
              <th className="text-right font-semibold py-1.5 px-2">Realizado</th>
              <th className="text-right font-semibold py-1.5 pl-2">Desvio</th>
            </tr>
          </thead>
          <tbody>
            {goals.rows.map((r) => (
              <Row key={r.categoryId} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-caption text-ink-3 flex-wrap pt-1 border-t border-border">
        <Key className="bg-status-ok" label="dentro da meta" />
        <Key className="bg-status-over" label="estourou" />
        <Key className="bg-elevated" label="sem meta no mês" />
      </div>
    </div>
  );
}

function Header({ period }: { period: AnnualPeriod }) {
  return (
    <div className="flex items-start gap-2">
      <Target size={14} className="text-ink-3 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <h3 className="text-title font-semibold text-text-primary">Comportamento das metas</h3>
        <p className="text-caption text-ink-3 mt-0.5">{period.label} · pior desvio primeiro</p>
      </div>
    </div>
  );
}

function Row({ row: r }: { row: GoalRow }) {
  const over = r.deviation > 0;
  return (
    <tr className="border-t border-border hover:bg-elevated/40 transition-colors">
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
          <span className="truncate">{r.name}</span>
        </span>
      </td>
      {/* A tira de 12 células é o "comportamento": um ano de estouros seguidos
          e um ano de um estouro isolado somam o mesmo desvio e pedem ações
          opostas — só a sequência separa os dois. */}
      <td className="py-1.5 px-2">
        <span className="flex gap-px" aria-hidden="true">
          {r.byMonth.map((c) => (
            <span
              key={c.key}
              className={`h-3.5 flex-1 rounded-[1px] ${
                c.noMeta
                  ? 'bg-elevated'
                  : c.realizado > c.meta
                    ? 'bg-status-over'
                    : 'bg-status-ok'
              }`}
              title={
                c.noMeta
                  ? `${shortMonthLabel(c.key)}: sem meta`
                  : `${shortMonthLabel(c.key)}: ${formatBRL(c.realizado)} de ${formatBRL(c.meta)}`
              }
            />
          ))}
        </span>
        <span className="sr-only">
          {r.monthsOver} de {r.monthsWithMeta} meses acima da meta
        </span>
      </td>
      <td className="py-1.5 px-2 text-right tnum text-text-secondary whitespace-nowrap">
        {formatBRL0(r.meta12m)}
      </td>
      <td className="py-1.5 px-2 text-right tnum whitespace-nowrap">{formatBRL0(r.real12m)}</td>
      <td
        className={`py-1.5 pl-2 text-right tnum whitespace-nowrap ${
          over ? 'text-status-over' : 'text-status-ok'
        }`}
      >
        {over ? '+' : ''}
        {formatBRL0(r.deviation)}
        {r.deviationPct !== null && (
          <span className="text-ink-3 font-normal">
            {' '}
            ({over ? '+' : ''}
            {r.deviationPct.toFixed(0)}%)
          </span>
        )}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  tone = 'text-text-primary',
  foot,
}: {
  label: string;
  value: string;
  tone?: string;
  foot: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3 leading-tight">
        {label}
      </p>
      <p className={`text-[19px] font-bold tracking-tight tnum leading-none truncate ${tone}`}>
        {value}
      </p>
      <p className="text-caption text-ink-3 truncate">{foot}</p>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-[2px] ${className}`} />
      {label}
    </span>
  );
}
