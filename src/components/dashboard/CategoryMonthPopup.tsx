import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { computeCategoryMonth } from '../../lib/categoryFlow';
import { formatBRL, formatBRL0, formatDate, getMonthLabel } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  categoryId: string;
  categoryName: string;
  color: string;
  /** Mês da barra clicada, "YYYY-MM". */
  monthYear: string;
  /** Média 12M da categoria, para dizer se o mês fugiu do padrão. */
  avg: number;
  onClose: () => void;
}

/** Lista completa é rolagem sem fim num popup; o resto vira uma linha. */
const TOP_N = 12;

/**
 * O que compõe uma categoria em UM mês — abre ao clicar numa barra da série de
 * 12 meses da análise.
 *
 * Clique, não hover: passar o mouse já mostra o valor no tooltip, e um popup
 * no hover abriria sem intenção ao atravessar o gráfico, sem deixar o ponteiro
 * chegar até ele — além de não existir no toque.
 */
export function CategoryMonthPopup({
  transactions,
  categories,
  categoryId,
  categoryName,
  color,
  monthYear,
  avg,
  onClose,
}: Props) {
  const detail = useMemo(
    () => computeCategoryMonth(transactions, categories, categoryId, monthYear),
    [transactions, categories, categoryId, monthYear],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const deltaPct = avg > 0 ? ((detail.total - avg) / avg) * 100 : null;
  const shown = detail.entries.slice(0, TOP_N);
  const rest = detail.entries.slice(TOP_N);
  const restSum = rest.reduce((s, e) => s + e.value, 0);
  const max = Math.max(...detail.subs.map((s) => Math.abs(s.value)), 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-bg-card border border-border rounded-card w-full max-w-lg max-h-full overflow-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <div className="min-w-0">
              <h3 className="text-title font-semibold text-text-primary truncate">{categoryName}</h3>
              <p className="text-caption text-ink-3">{getMonthLabel(monthYear)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="tap p-1 -m-1 text-ink-3 hover:text-text-primary transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[21px] font-bold tracking-tight tnum text-text-primary">
            {formatBRL0(detail.total)}
          </span>
          {deltaPct !== null && Math.abs(deltaPct) >= 0.5 && (
            <span className={`text-body tnum ${deltaPct > 0 ? 'text-negative' : 'text-positive'}`}>
              {deltaPct > 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(0)}%{' '}
              <span className="text-ink-3">vs média 12M ({formatBRL0(avg)})</span>
            </span>
          )}
        </div>

        {detail.entries.length === 0 ? (
          <p className="text-caption text-ink-3">Nenhum lançamento nesta categoria no mês.</p>
        ) : (
          <>
            {detail.subs.length > 1 && (
              <div className="space-y-1 pt-1 border-t border-border">
                {detail.subs.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="text-body text-text-secondary truncate w-40 flex-shrink-0">
                      {s.name}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden min-w-0">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(Math.abs(s.value) / max) * 100}%`, backgroundColor: s.color }}
                      />
                    </div>
                    <span className="text-body tnum text-text-primary flex-shrink-0 w-24 text-right">
                      {formatBRL0(s.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-0.5 pt-1 border-t border-border">
              <p className="text-caption uppercase tracking-wider text-ink-3 pb-0.5">
                Lançamentos · {detail.entries.length}
              </p>
              {shown.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline justify-between gap-2 rounded px-1 -mx-1 py-0.5 [@media(hover:hover)]:hover:bg-white/[0.06] transition-colors"
                  title={e.account ? `${e.account} · ${formatDate(e.date)}` : formatDate(e.date)}
                >
                  <span className="min-w-0 flex items-baseline gap-1.5">
                    <span className="text-body text-text-primary truncate">{e.description}</span>
                    {e.subName && (
                      <span
                        className="text-caption flex-shrink-0 truncate"
                        style={{ color: e.subColor || undefined }}
                      >
                        {e.subName}
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-2 flex-shrink-0">
                    <span className="text-caption text-ink-3 tnum">{formatDate(e.date)}</span>
                    <span
                      className={`text-body tnum w-24 text-right ${
                        e.value < 0 ? 'text-positive' : 'text-text-primary'
                      }`}
                    >
                      {formatBRL(e.value)}
                    </span>
                  </span>
                </div>
              ))}
              {rest.length > 0 && (
                <div className="flex items-baseline justify-between gap-2 px-1 pt-1 text-caption text-ink-3">
                  <span>
                    + {rest.length} {rest.length === 1 ? 'lançamento menor' : 'lançamentos menores'}
                  </span>
                  <span className="tnum">{formatBRL0(restSum)}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
