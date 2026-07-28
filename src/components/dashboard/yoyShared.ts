import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Tipos e helper de tendência do painel "O que puxou o ano".
 * (Arquivo separado do componente porque o Fast Refresh exige que um arquivo
 * de componente exporte só componentes.)
 */

export interface YoySubItem {
  id: string;
  name: string;
  icon: string;
  color: string;
  curr: number;
  prev: number;
  varianceAbs: number;
  pct: number | null;
  resultadoImpact?: number;
}

export interface YoyItem extends YoySubItem {
  subs: YoySubItem[];
}

export interface GroupTotal {
  curr: number;
  prev: number;
  varianceAbs: number;
  pct: number | null;
  /** Só no Resultado: variação da taxa de poupança em pontos percentuais. */
  savingsRatePp?: number | null;
}

export type TrendUnit = 'pct' | 'pp';

export interface TrendResult {
  color: string;
  Icon: typeof TrendingUp;
  text: string;
  /** false quando não há número (—/novo): aí a seta seria ruído ao lado do traço. */
  hasValue: boolean;
}

/**
 * Cor + ícone + texto de uma variação.
 *
 * Política de valor ausente (antes espalhada como 'n/d' / 'sem dados'):
 *  - sem ano anterior            → '—'
 *  - base zero e valor atual > 0 → 'novo' (informativo, não é erro)
 *  - base zero e valor atual = 0 → '—'
 */
export function resolveTrend(
  value: number | null,
  higherIsBetter: boolean,
  opts: { hasPrev?: boolean; unit?: TrendUnit; isNew?: boolean } = {},
): TrendResult {
  const { hasPrev = true, unit = 'pct', isNew = false } = opts;
  const muted = { color: 'text-ink-3', Icon: Minus as typeof TrendingUp };

  if (!hasPrev) return { ...muted, text: '—', hasValue: false };
  if (isNew) return { ...muted, text: 'novo', hasValue: false };
  if (value === null) return { ...muted, text: '—', hasValue: false };

  const suffix = unit === 'pp' ? ' p.p.' : '%';

  // Zona morta: variação irrelevante não merece cor, seta nem sinal ("-0,0").
  if (Math.abs(value) < 0.05) return { ...muted, text: `0,0${suffix}`, hasValue: true };

  const text = `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}${suffix}`;

  const isBetter = higherIsBetter ? value > 0 : value < 0;
  return {
    color: isBetter ? 'text-positive' : 'text-negative',
    Icon: value > 0 ? TrendingUp : TrendingDown,
    text,
    hasValue: true,
  };
}
