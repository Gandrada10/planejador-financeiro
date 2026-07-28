import { formatBRL0 } from '../../lib/utils';
import { budgetLabel } from './budgetShared';

/** Fatia da trilha que cabe ao orçado; o resto é a zona de estouro. */
const BUDGET_ZONE = 86;
/** Teto da zona de estouro: ela representa de 100% a 200% do orçado. */
const OVER_CAP = 200;
/** Piso visual do excedente — 102% precisa aparecer, não virar um fio. */
const MIN_OVER = 0.16;
interface Props {
  /** Gasto acumulado, positivo. */
  spent: number;
  budget: number | null;
  color: string;
  /** Rótulo "faltam / estourou" abaixo da barra. */
  withLabel?: boolean;
}

/**
 * Régua de orçamento no idioma do bullet chart, com ZONA DE ESTOURO
 * RESERVADA: a trilha reserva sempre uma faixa à direita para o excedente, e a
 * linha do 100% fica na MESMA posição em todas as linhas — é isso que deixa os
 * projetos comparáveis de relance.
 *
 * Enquanto não é atingida, a faixa é apenas translúcida (sem cor de alarme).
 * Ao estourar, o preenchimento do orçado vira cinza (deixou de ser progresso,
 * virou teto ultrapassado) e o excedente cresce dentro da faixa até 200% do
 * orçado; daí em diante ela satura hachurada — não cresce mais, só muda de
 * aparência, e o valor em reais ao lado carrega a magnitude real.
 */
export function BudgetRuler({ spent, budget, color, withLabel }: Props) {
  const label = budgetLabel(spent, budget);

  return (
    <div className="space-y-1">
      {budget === null || budget <= 0 ? (
        <div className="h-2.5 rounded-full bg-elevated overflow-hidden">
          <div className="h-full w-full opacity-30" style={{ backgroundColor: color }} />
        </div>
      ) : (
        <Bar spent={spent} budget={budget} color={color} />
      )}
      {withLabel && (
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="text-ink-3 tnum">
            {formatBRL0(spent)}
            {budget && budget > 0 ? ` de ${formatBRL0(budget)}` : ''}
          </span>
          <span className={`tnum ${label.cls}`}>{label.text}</span>
        </div>
      )}
    </div>
  );
}

function Bar({ spent, budget, color }: { spent: number; budget: number; color: string }) {
  const pct = (spent / budget) * 100;
  const over = pct > 100;
  const overRatio = over ? Math.max(Math.min((pct - 100) / (OVER_CAP - 100), 1), MIN_OVER) : 0;
  const saturated = pct >= OVER_CAP;

  return (
    <div className="relative h-2.5">
      <div className="absolute inset-0 rounded-full overflow-hidden flex">
        <div className="h-full bg-elevated" style={{ width: `${BUDGET_ZONE}%` }}>
          <div
            className="h-full"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: over ? '#8f8e89' : color }}
          />
        </div>
        {/* Zona reservada: translúcida enquanto intacta — sem alarme à toa. */}
        <div
          className="h-full"
          style={{ width: `${100 - BUDGET_ZONE}%`, backgroundColor: 'rgba(255,255,255,0.05)' }}
        >
          {over && (
            <div
              className="h-full"
              style={
                saturated
                  ? {
                      width: '100%',
                      backgroundImage:
                        'repeating-linear-gradient(135deg, #e05a4d 0 4px, #b8453a 4px 8px)',
                    }
                  : { width: `${overRatio * 100}%`, backgroundColor: '#e05a4d' }
              }
            />
          )}
        </div>
      </div>
      {/* Marcador do 100%: mesma posição em toda linha. */}
      <div
        className="absolute top-[-2px] bottom-[-2px] w-[2px] rounded-full"
        style={{ left: `${BUDGET_ZONE}%`, backgroundColor: '#f5f4f2', opacity: 0.85 }}
      />
    </div>
  );
}
