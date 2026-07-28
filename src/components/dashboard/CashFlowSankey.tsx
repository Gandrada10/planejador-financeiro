import { Sankey, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { MONEY, FONT } from '../../lib/chartTheme';
import { formatBRL0 } from '../../lib/utils';
import type { FlowSlice } from '../../lib/categoryFlow';

interface Props {
  income: number;
  balance: number;
  categories: FlowSlice[];
  /** Ids de categorias-mãe abertas em subcategoria. */
  expanded: Set<string>;
  onToggleCategory: (id: string) => void;
  /** Sufixo dos valores: "/mês" na visão de 12 meses. */
  unit?: string;
}

/** Piso: abaixo disso a fatia é um fio invisível e só suja o diagrama. */
const MIN_SHARE = 0.003;
/** Espaço vertical reservado por folha, para o rótulo caber. */
const ROW_SPACE = 30;

interface SankeyNodeDef {
  name: string;
  color: string;
  share: number | null;
  unit: string;
  /** Presente só em categoria-mãe com subcategorias: alterna a expansão. */
  onToggle?: () => void;
  open?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts não tipa os
   props injetados em node/link customizados do Sankey */

function SankeyNodeShape(props: any) {
  const { x, y, width, height, payload } = props;
  const tx = x + width + 8;
  const compact = height < 26;
  const clickable = !!payload.onToggle;
  const caret = payload.open ? '⌄ ' : '› ';

  return (
    <Layer
      style={clickable ? { cursor: 'pointer' } : undefined}
      onClick={payload.onToggle}
    >
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} radius={2} />
      {/* Área de toque generosa sobre o rótulo — a barra tem 10px de largura */}
      {clickable && <rect x={x} y={y - 6} width={190} height={height + 12} fill="transparent" />}
      <text
        x={tx}
        y={y + height / 2 + (compact ? 3.5 : -2)}
        textAnchor="start"
        fontFamily={FONT}
        fontSize={11}
        fontWeight={600}
        fill="#f5f4f2"
        stroke="#1b1b1e"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {clickable && <tspan fill="#8f8e89">{caret}</tspan>}
        {payload.name}
        {compact && (
          <tspan fontWeight={400} fill="#8f8e89">
            {' '}
            {formatBRL0(payload.value)}
            {payload.unit}
          </tspan>
        )}
      </text>
      {!compact && (
        <text
          x={tx}
          y={y + height / 2 + 12}
          textAnchor="start"
          fontFamily={FONT}
          fontSize={10.5}
          fill="#8f8e89"
          stroke="#1b1b1e"
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {formatBRL0(payload.value)}
          {payload.unit}
          {payload.share !== null && ` · ${payload.share.toFixed(0)}%`}
        </text>
      )}
    </Layer>
  );
}

function SankeyLinkShape(props: any) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload, index } = props;
  const id = `sankey-link-${index}`;
  return (
    <Layer>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={sourceX} x2={targetX} y1={sourceY} y2={targetY}>
          <stop offset="0%" stopColor={payload.source.color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={payload.target.color} stopOpacity={0.45} />
        </linearGradient>
      </defs>
      <path
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={Math.max(linkWidth, 1)}
      />
    </Layer>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fluxo do dinheiro (Sankey, à la Monarch Money).
 *
 * RESULTADO LÍQUIDO existe sempre e a POSIÇÃO codifica o sinal: superávit sai
 * pela direita (virou reserva), déficit entra pela esquerda (consumiu reserva).
 * Sankey não representa fluxo negativo — é assim que o diagrama fecha, e é o
 * que de fato acontece com o dinheiro.
 *
 * SINAL das categorias: saldo POSITIVO é reembolso líquido — dinheiro que
 * voltou. Entra como fonte, nunca como destino.
 *
 * Com uma fonte só, o nó "Caixa" não é criado: seriam dois blocos gigantes
 * com o mesmo valor ocupando metade do card sem informação nenhuma.
 */
export function CashFlowSankey({ income, balance, categories, expanded, onToggleCategory, unit = '' }: Props) {
  const outCats = categories
    .filter((c) => c.amount < 0)
    .map((c) => ({ ...c, value: -c.amount }))
    .sort((a, b) => b.value - a.value);
  const inCats = categories.filter((c) => c.amount > 0).map((c) => ({ ...c, value: c.amount }));

  const totalOut = outCats.reduce((s, c) => s + c.value, 0);
  if (totalOut === 0 && income <= 0) {
    return <p className="text-caption text-ink-3 text-center py-10">Sem movimento neste período.</p>;
  }

  const inflow = income + inCats.reduce((s, c) => s + c.value, 0);
  const available = Math.max(inflow, totalOut);
  const shareOf = (v: number) => (available > 0 ? (v / available) * 100 : null);

  const nodes: SankeyNodeDef[] = [];
  const links: Array<{ source: number; target: number; value: number }> = [];
  const push = (n: SankeyNodeDef) => nodes.push(n) - 1;
  const node = (name: string, color: string, value: number, extra: Partial<SankeyNodeDef> = {}) =>
    push({ name, color, share: shareOf(value), unit, ...extra });

  // ---- Fontes (déficit primeiro: é a manchete do mês) ----
  const sources: Array<{ idx: number; value: number }> = [];
  if (balance < 0) {
    sources.push({ idx: node('Resultado líquido', MONEY.expense, -balance), value: -balance });
  }
  if (income > 0) sources.push({ idx: node('Receitas', MONEY.income, income), value: income });
  for (const c of inCats) {
    sources.push({ idx: node(c.name, c.color || MONEY.income, c.value), value: c.value });
  }

  // Uma fonte só não merece um nó de passagem: ela mesma vira o centro.
  // O hub NÃO leva %: ele é o total (100% por definição) — mostrar a fração
  // de uma das entradas ali contradizia o próprio valor exibido ao lado.
  let hubIdx: number;
  if (sources.length <= 1) {
    hubIdx = sources[0]?.idx ?? push({ name: 'Caixa', color: MONEY.balance, share: null, unit });
  } else {
    hubIdx = push({ name: 'Caixa do período', color: MONEY.balance, share: null, unit });
    for (const s of sources) links.push({ source: s.idx, target: hubIdx, value: s.value });
  }

  // ---- Destinos: resultado positivo primeiro, depois categorias ----
  if (balance > 0) {
    links.push({ source: hubIdx, target: node('Resultado líquido', MONEY.income, balance), value: balance });
  }

  for (const c of outCats) {
    if (c.value / totalOut < MIN_SHARE) continue;

    // Só divide quando os filhos cabem no pai: um sub com reembolso poderia
    // estourar o total e distorcer os valores.
    const subOut = c.subs
      .filter((s) => s.amount < 0)
      .map((s) => ({ ...s, value: -s.amount }))
      .filter((s) => s.value / totalOut >= 0.005)
      .sort((a, b) => b.value - a.value);
    const subSum = subOut.reduce((s, x) => s + x.value, 0);
    const canExpand = subOut.length > 0 && subSum <= c.value + 0.01;
    const isOpen = canExpand && expanded.has(c.id);

    const parentIdx = node(c.name, c.color, c.value, {
      onToggle: canExpand ? () => onToggleCategory(c.id) : undefined,
      open: isOpen,
    });
    links.push({ source: hubIdx, target: parentIdx, value: c.value });
    if (!isOpen) continue;

    for (const s of subOut) {
      links.push({ source: parentIdx, target: node(s.name, s.color || c.color, s.value), value: s.value });
    }
    const remainder = c.value - subSum;
    if (remainder > totalOut * 0.005) {
      links.push({
        source: parentIdx,
        target: node(`${c.name} · outros`, c.color, remainder),
        value: remainder,
      });
    }
  }

  // Altura pela coluna mais cheia (as folhas), que é quem precisa de rótulo.
  const sourceIdx = new Set(links.map((l) => l.source));
  const leafCount = nodes.filter((_, i) => !sourceIdx.has(i)).length;
  const height = Math.max(320, leafCount * ROW_SPACE);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodeWidth={10}
          nodePadding={14}
          margin={{ top: 12, right: 190, bottom: 12, left: 4 }}
          node={SankeyNodeShape}
          link={SankeyLinkShape}
          // Preserva a ordem de inserção no eixo vertical (o padrão reordena
          // por valor e jogava o Resultado líquido para o meio da lista).
          sort={false}
        />
      </ResponsiveContainer>
    </div>
  );
}
