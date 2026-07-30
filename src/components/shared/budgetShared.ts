import { formatBRL, formatBRL0 } from '../../lib/utils';

/** A partir daqui o rótulo avisa que está perto de estourar. */
const NEAR = 85;

/**
 * Abaixo disto o valor sai COM centavos.
 *
 * O rótulo anda ao lado de "R$ 39.996 de R$ 40.000", e ali um "faltam R$ 4"
 * arredondado parece um milhar que o layout decepou — foi exatamente essa a
 * leitura de quem viu o card. Com centavos ("faltam R$ 3,80") o número se
 * anuncia inteiro: ninguém corta uma casa decimal por falta de espaço.
 */
const CENTS_BELOW = 100;

const money = (v: number) => (v < CENTS_BELOW ? formatBRL(v) : formatBRL0(v));

/** Texto e cor do estado do orçamento, compartilhado pela régua e pelas listas. */
export function budgetLabel(spent: number, budget: number | null) {
  if (budget === null || budget <= 0) return { text: 'sem orçamento', cls: 'text-ink-3' };
  const pct = (spent / budget) * 100;
  if (pct > 100)
    return { text: `estourou ${money(spent - budget)}`, cls: 'text-negative font-semibold' };
  if (pct >= NEAR) return { text: `faltam ${money(budget - spent)}`, cls: 'text-status-warn' };
  return { text: `faltam ${money(budget - spent)}`, cls: 'text-ink-3' };
}
