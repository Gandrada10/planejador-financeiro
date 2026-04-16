import { useState } from 'react';
import { X, History } from 'lucide-react';
import { getMonthLabel, formatDate } from '../../lib/utils';
import type { CategorizationSession } from '../../types';

interface Props {
  sessions: CategorizationSession[];
  onOpenDetail: (session: CategorizationSession) => void;
  onClose: () => void;
}

const PAGE_SIZE = 20;

function statusInfo(s: CategorizationSession): { label: string; tone: string } {
  if (s.status === 'applied') {
    const when = s.appliedAt ? formatDate(s.appliedAt) : '';
    return { label: when ? `Aplicado em ${when}` : 'Aplicado', tone: 'text-accent-green' };
  }
  if (s.status === 'dismissed') return { label: 'Dispensado', tone: 'text-text-secondary' };
  return { label: 'Em andamento', tone: 'text-accent' };
}

export function CategorizationHistoryListModal({ sessions, onOpenDetail, onClose }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <History size={16} className="text-accent" />
            Histórico de categorizações
            <span className="text-[10px] text-text-secondary font-normal">
              ({sessions.length} • últimos 90 dias)
            </span>
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-secondary">
              Nenhuma sessão no histórico. Links gerados e aplicados aparecem aqui.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sessions.slice(0, visible).map((s) => {
                const status = statusInfo(s);
                const period = s.monthFilter && s.monthFilter !== 'all'
                  ? getMonthLabel(s.monthFilter)
                  : 'Todos os meses';
                const accountsLabel = s.accounts.length > 0 ? s.accounts.join(' • ') : '—';
                return (
                  <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs hover:bg-bg-secondary">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-secondary">{formatDate(s.createdAt)}</span>
                        <span className="text-text-primary font-medium">{s.titularName}</span>
                        <span className="text-text-secondary">• {period}</span>
                        <span className={`${status.tone} font-medium`}>• {status.label}</span>
                      </div>
                      <div className="text-[11px] text-text-secondary truncate mt-0.5">
                        {accountsLabel} — {s.transactionIds.length} enviados • {s.categorizedCount} categorizados
                        {s.status === 'applied' && ` • ${s.appliedCount} aplicados`}
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenDetail(s)}
                      className="px-2 py-1 bg-bg-secondary border border-border text-text-primary text-[11px] rounded hover:border-accent whitespace-nowrap"
                    >
                      Ver detalhes
                    </button>
                  </div>
                );
              })}
              {sessions.length > visible && (
                <button
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="w-full py-2 text-[11px] text-accent hover:bg-bg-secondary"
                >
                  Ver mais ({sessions.length - visible})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
