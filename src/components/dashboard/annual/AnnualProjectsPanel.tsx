import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { formatBRL0 } from '../../../lib/utils';
import { BudgetRuler } from '../../shared/BudgetRuler';
import type { AnnualProjectRow, AnnualPeriod } from '../../../lib/annualStats';

interface Props {
  rows: AnnualProjectRow[];
  period: AnnualPeriod;
  className?: string;
}

type Tab = 'active' | 'archived';

/**
 * Projetos da janela em ABAS — "Em andamento" e "Concluídos" com o mesmo peso.
 * No dashboard mensal os concluídos ficam numa seção colapsável, o que faz
 * sentido para o mês (o que está rodando é o que importa hoje); na leitura
 * anual o retrospecto é metade da pergunta: quanto custou o que eu terminei.
 */
export function AnnualProjectsPanel({ rows, period, className = '' }: Props) {
  const active = rows.filter((r) => r.status === 'active');
  const archived = rows.filter((r) => r.status === 'archived');
  // Abre na aba que tem o que mostrar — abrir vazia por padrão é um clique
  // desperdiçado para quem só tem projetos concluídos na janela.
  const [tab, setTab] = useState<Tab>(active.length > 0 || archived.length === 0 ? 'active' : 'archived');

  const list = tab === 'active' ? active : archived;

  return (
    <div className={`bg-bg-card border border-border rounded-card p-4 space-y-3 ${className}`}>
      <div className="flex items-start gap-2">
        <FolderKanban size={14} className="text-ink-3 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Projetos</h3>
          <p className="text-caption text-ink-3 mt-0.5">{period.label} · gasto dentro da janela</p>
        </div>
      </div>

      <div className="flex gap-4 border-b border-border" role="tablist">
        <TabButton active={tab === 'active'} onClick={() => setTab('active')} count={active.length}>
          Em andamento
        </TabButton>
        <TabButton active={tab === 'archived'} onClick={() => setTab('archived')} count={archived.length}>
          Concluídos
        </TabButton>
      </div>

      {list.length === 0 ? (
        <p className="text-body text-text-secondary leading-snug">
          {tab === 'active'
            ? 'Nenhum projeto em andamento com movimento na janela.'
            : 'Nenhum projeto concluído nesta janela.'}
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <div key={p.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <Link
                  to={`/projetos/${p.id}`}
                  className="flex items-center gap-1.5 min-w-0 hover:text-accent transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="truncate">{p.name}</span>
                </Link>
                <span className="text-body tnum whitespace-nowrap flex-shrink-0">
                  {formatBRL0(p.spent12m)}
                </span>
              </div>

              <BudgetRuler spent={p.spentTotal} budget={p.budget} color={p.color} withLabel />

              <p className="text-caption text-ink-3">
                {p.startLabel}
                {p.endLabel ? ` – ${p.endLabel}` : p.status === 'active' ? ' – em curso' : ''}
                {/* Gasto total só aparece quando difere do da janela: repetir o
                    mesmo número duas vezes por linha é ruído. */}
                {Math.round(p.spentTotal) !== Math.round(p.spent12m) && (
                  <> · {formatBRL0(p.spentTotal)} no projeto inteiro</>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`tap pb-2 -mb-px border-b-2 text-body font-medium transition-colors ${
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
      <span className="text-ink-3 tnum"> ({count})</span>
    </button>
  );
}
