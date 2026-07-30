import { formatBRL } from '../../lib/utils';

export interface BudgetRow {
  categoryName: string;
  icon: string;
  color: string;
  limit: number;
  spent: number;
  remaining: number;
  isParent: boolean;
}

interface Props {
  rows: BudgetRow[];
  /** Do layout do dashboard: `lg:flex-1` faz este card, último da coluna,
   *  absorver a folga de altura em vez de deixá-la virar vazio na página. */
  className?: string;
}

/**
 * Metas de despesa do mês: limite, realizado e a barra de consumo por
 * categoria-mãe, com o total fechando embaixo.
 *
 * Vivia como ~70 linhas de JSX dentro do DashboardPage, que já é o arquivo
 * mais carregado do app — aqui os totais também deixam de ser recalculados no
 * corpo da página.
 */
export function BudgetGoalsPanel({ rows, className = '' }: Props) {
  const parents = rows.filter((b) => b.isParent);
  const totalLimit = parents.reduce((s, b) => s + b.limit, 0);
  const totalActual = parents.reduce((s, b) => s + b.spent, 0);
  const totalPct = totalLimit > 0 ? Math.min((totalActual / totalLimit) * 100, 100) : 0;
  const totalOver = totalLimit > 0 && totalActual > totalLimit;

  return (
    <div className={`bg-bg-card border border-border rounded-card p-4 flex flex-col gap-3 ${className}`}>
      <h3 className="text-title font-semibold text-text-primary">Metas de despesas</h3>
  {rows.length === 0 ? (
    // Centralizado no espaço que sobrar: este é o último card da coluna e
    // pode ser esticado para fechar a altura. Um aviso curto grudado no topo
    // de um card alto parece defeito; centrado, parece um estado vazio.
    <p className="flex-1 grid place-items-center text-center text-caption text-ink-3 py-2">
      Nenhuma meta definida para este mês.
    </p>
  ) : (
    <div className="space-y-2">
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 text-caption text-ink-3 uppercase tracking-wider">
        <span />
        <span className="text-right">Meta</span>
        <span className="text-right">Realizado</span>
        <span className="text-right">A realizar</span>
      </div>

      {rows.map((b, i) => {
        const pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
        const over = b.spent > b.limit;
        const barPct = Math.min(pct, 100);
        return (
          <div key={i} className="grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 items-center">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="w-0.5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                <span className={`text-body truncate ${b.isParent ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                  {b.categoryName}
                </span>
              </div>
              <div className="flex items-center gap-1.5 pl-2.5">
                <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${over ? 'bg-accent-red' : 'bg-accent'}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <span className={`text-caption tnum ${over ? 'text-accent-red' : 'text-ink-3'}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            </div>
            <span className="text-body tnum text-text-primary text-right">{formatBRL(b.limit)}</span>
            <span className={`text-body tnum text-right ${over ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(b.spent)}</span>
            <span className="text-body tnum text-text-secondary text-right">{formatBRL(b.remaining)}</span>
          </div>
        );
      })}

      {/* Total */}
      <div className="pt-2 border-t border-border grid grid-cols-[1fr_repeat(3,_minmax(60px,_80px))] gap-2 items-center">
        <div className="space-y-1">
          <span className="text-body font-semibold text-text-primary">Total</span>
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${totalOver ? 'bg-accent-red' : 'bg-accent'}`}
                style={{ width: `${totalPct}%` }}
              />
            </div>
            <span className={`text-caption tnum ${totalOver ? 'text-accent-red' : 'text-ink-3'}`}>
              {totalPct.toFixed(0)}%
            </span>
          </div>
        </div>
        <span className="text-body tnum font-semibold text-text-primary text-right">{formatBRL(totalLimit)}</span>
        <span className={`text-body tnum font-semibold text-right ${totalOver ? 'text-accent-red' : 'text-text-primary'}`}>{formatBRL(totalActual)}</span>
        <span className="text-body tnum text-text-secondary text-right">{formatBRL(Math.max(totalLimit - totalActual, 0))}</span>
      </div>
    </div>
  )}
    </div>
  );
}
