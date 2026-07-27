import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Grade, tipos e helpers de tendência compartilhados pelo painel de Desvio YoY.
 * (Separado de YoyRow.tsx porque o Fast Refresh exige que um arquivo de
 * componente exporte só componentes.)
 *
 * A grade é a MESMA para a linha-resumo (Despesas/Receitas/Resultado) e para as
 * linhas de categoria/subcategoria do drill-down — é isso que faz o total e suas
 * categorias lerem como uma tabela contínua, e o que resolve o truncamento de
 * valores que existia quando os 3 totais dividiam uma faixa de ~110px.
 *
 * A coluna "Anterior" cai abaixo de 34rem via CONTAINER query (não media query):
 * a restrição de largura aqui é o `lg:grid-cols-2` do dashboard, não o viewport.
 */
export const YOY_ROW_GRID =
  'grid items-center gap-x-2 ' +
  'grid-cols-[14px_minmax(0,1fr)_96px_104px_68px] ' +
  '@min-[34rem]:grid-cols-[14px_minmax(0,1fr)_96px_96px_104px_68px]';

/** Célula "Anterior": só existe a partir de 34rem de largura do card. */
export const YOY_PREV_CELL = 'hidden @min-[34rem]:block';

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
  const text = `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}${suffix}`;

  // Zona morta: variação irrelevante não merece cor nem seta.
  if (Math.abs(value) < 0.05) return { ...muted, text, hasValue: true };

  const isBetter = higherIsBetter ? value > 0 : value < 0;
  return {
    color: isBetter ? 'text-positive' : 'text-negative',
    Icon: value > 0 ? TrendingUp : TrendingDown,
    text,
    hasValue: true,
  };
}

/** Cor/ícone de um impacto em R$ no resultado (positivo é sempre bom). */
export function resolveImpact(impact: number): { color: string; Icon: typeof TrendingUp } {
  if (impact > 0) return { color: 'text-positive', Icon: TrendingUp };
  if (impact < 0) return { color: 'text-negative', Icon: TrendingDown };
  return { color: 'text-ink-3', Icon: Minus };
}

/** Cor de um delta em R$, respeitando se subir é bom (receita) ou ruim (despesa). */
export function toneForDelta(delta: number, higherIsBetter: boolean): string {
  if (Math.abs(delta) < 0.005) return 'text-ink-3';
  return (higherIsBetter ? delta > 0 : delta < 0) ? 'text-positive' : 'text-negative';
}
