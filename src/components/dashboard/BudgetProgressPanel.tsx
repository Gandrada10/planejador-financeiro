import { formatBRL } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';

interface BudgetItem {
  categoryName: string;
  icon: string;
  limit: number;
  actual: number;
  remaining: number;
}

interface Props {
  data: BudgetItem[];
  totalLimit: number;
  totalActual: number;
  totalRemaining: number;
}

export function BudgetProgressPanel({ data, totalLimit, totalActual, totalRemaining }: Props) {
  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Metas de despesas</h3>

      {data.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.map((b, i) => {
              const pct = b.limit > 0 ? Math.min((Math.abs(b.actual) / b.limit) * 100, 100) : 0;
              const over = b.limit > 0 && Math.abs(b.actual) > b.limit;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-primary flex items-center gap-1"><CategoryIcon icon={b.icon} size={12} className="text-text-primary" /> {b.categoryName}</span>
                  </div>
                  <div className="w-full h-2 bg-bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? 'bg-accent-red' : 'bg-accent-green'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-text-secondary">
                    <span>Meta: {formatBRL(b.limit)}</span>
                    <span>Realizado: {formatBRL(Math.abs(b.actual))}</span>
                    <span>A realizar: {formatBRL(b.remaining)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border pt-2">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-text-primary">Total</span>
              <div className="flex gap-4">
                <span className="text-text-secondary">{formatBRL(totalLimit)}</span>
                <span className="text-text-primary">{formatBRL(totalActual)}</span>
                <span className="text-text-secondary">{formatBRL(totalRemaining)}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-text-secondary">
          Nenhuma meta definida para este mes. Configure metas na pagina de Orcamento.
        </p>
      )}
    </div>
  );
}
