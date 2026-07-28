import { formatBRL0 } from '../../lib/utils';

/** A partir daqui o rótulo avisa que está perto de estourar. */
const NEAR = 85;

/** Texto e cor do estado do orçamento, compartilhado pela régua e pelas listas. */
export function budgetLabel(spent: number, budget: number | null) {
  if (budget === null || budget <= 0) return { text: 'sem orçamento', cls: 'text-ink-3' };
  const pct = (spent / budget) * 100;
  if (pct > 100)
    return { text: `estourou ${formatBRL0(spent - budget)}`, cls: 'text-negative font-semibold' };
  if (pct >= NEAR) return { text: `faltam ${formatBRL0(budget - spent)}`, cls: 'text-status-warn' };
  return { text: `faltam ${formatBRL0(budget - spent)}`, cls: 'text-ink-3' };
}
