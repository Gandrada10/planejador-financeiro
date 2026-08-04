import { CalendarClock } from 'lucide-react';
import { formatBRL0, formatBRL } from '../../../lib/utils';
import { MONEY } from '../../../lib/chartTheme';
import type { Commitments } from '../../../lib/annualStats';

interface Props {
  commitments: Commitments;
}

/**
 * O que JÁ ESTÁ comprometido nos próximos 12 meses. Não é previsão: são
 * despesas que já existem no banco com data futura — na prática as parcelas
 * que a importação de fatura grava adiantadas, uma linha por mês.
 *
 * Nenhuma tela do app mostrava isso, e é a informação mais acionável para
 * planejar: dá para ver o mês em que o caixa aperta com meses de antecedência,
 * enquanto ainda dá tempo de fazer algo a respeito.
 */
export function CommitmentsPanel({ commitments: c }: Props) {
  const max = Math.max(...c.months.map((m) => m.total), 1);
  const installmentShare = c.total > 0 ? c.installmentTotal / c.total : 0;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <CalendarClock size={14} className="text-ink-3 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Já comprometido</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            próximos 12 meses · lançamentos com data futura já registrados
          </p>
        </div>
      </div>

      {!c.hasData ? (
        <p className="text-body text-text-secondary leading-snug">
          Nada agendado para os próximos meses. Compras parceladas importadas de fatura aparecem
          aqui automaticamente, uma parcela por mês.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[24px] font-bold tracking-tight tnum leading-none text-text-primary">
              {formatBRL0(c.total)}
            </span>
            <span className="text-caption text-ink-3">
              {installmentShare >= 0.05
                ? `${(installmentShare * 100).toFixed(0)}% em parcelas`
                : 'em lançamentos agendados'}
            </span>
          </div>

          {/* Barras por mês: a leitura é o PICO, não os valores individuais —
              por isso a escala é comum e o rótulo só aparece no maior. */}
          <div className="scroll-x">
            {/* Sem `items-end` aqui: ele impediria as colunas de esticarem até
                os 92px, e o `flex-1` da barra não teria altura para ocupar. O
                alinhamento pela base é feito DENTRO de cada coluna. */}
            <div className="min-w-[420px] flex items-stretch gap-1.5 h-[92px]">
              {c.months.map((m) => {
                const share = m.total / max;
                const isPeak = c.peak?.key === m.key && m.total > 0;
                return (
                  <div
                    key={m.key}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    title={`${m.label}: ${formatBRL(m.total)}${m.count > 0 ? ` · ${m.count} ${m.count === 1 ? 'lançamento' : 'lançamentos'}` : ''}`}
                  >
                    <span className="text-caption tnum text-ink-3 leading-none h-3">
                      {isPeak ? formatBRL0(m.total) : ''}
                    </span>
                    <div className="w-full flex-1 flex items-end">
                      {/* Todas as barras são DESPESA, então todas usam o coral
                          — o pico em cheio, os demais atenuados. Cinza neutro
                          some contra a superfície do card e some com o dado. */}
                      <div
                        className="w-full rounded-t-[3px]"
                        style={{
                          height: `${Math.max(share * 100, m.total > 0 ? 4 : 0)}%`,
                          backgroundColor: MONEY.expense,
                          opacity: isPeak ? 1 : 0.5,
                        }}
                      />
                    </div>
                    <span className="text-caption text-ink-3 leading-none truncate w-full text-center">
                      {m.label.slice(0, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {c.peak && (
            <p className="text-body text-text-secondary leading-snug pt-1 border-t border-border">
              O aperto é em <span className="font-semibold text-text-primary">{c.peak.label}</span>
              , com <span className="tnum text-negative">{formatBRL0(c.peak.total)}</span> já
              contratados — planeje esse mês antes que ele chegue.
            </p>
          )}
        </>
      )}
    </div>
  );
}
