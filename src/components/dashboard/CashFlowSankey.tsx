import { Sankey, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { MONEY, FONT } from '../../lib/chartTheme';
import { formatBRL0 } from '../../lib/utils';
import type { FlowSlice } from '../../lib/categoryFlow';

interface Props {
  income: number;
  balance: number;
  categories: FlowSlice[];
  /** Sufixo dos valores: "/mês" na visão de 12 meses. */
  unit?: string;
  /** Categoria em análise no painel lateral (destacada no diagrama). */
  selectedId?: string | null;
  /** Clique numa categoria de gasto → análise no painel. */
  onSelectCategory?: (id: string) => void;
  /** Média mensal 12M por id de categoria — liga o Δ vs média nos rótulos. */
  averages?: Map<string, number>;
}

/** Piso: abaixo disso a fatia é um fio invisível e só suja o diagrama. */
const MIN_SHARE = 0.003;
/** Espaço vertical por folha: 2 linhas de rótulo (~24px) + respiro. */
const ROW_SPACE = 38;
/**
 * Vão mínimo entre nós: o rótulo tem ~24px de altura centrado no nó, então
 * dois nós minúsculos vizinhos precisam de pelo menos isso de distância —
 * com menos, "Luz" escrevia por cima de "Moradia · outros".
 */
const NODE_PADDING = 26;
/** Nome maior que isso ganha reticências — o VALOR nunca é cortado. */
const MAX_NAME = 26;

interface SankeyNodeDef {
  name: string;
  color: string;
  share: number | null;
  unit: string;
  /** Mês vs média 12M, em % — só nas categorias de gasto na visão de mês. */
  delta?: number | null;
  /** Presente nas categorias de gasto: abre a análise no painel lateral. */
  onSelect?: () => void;
  selected?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts não tipa os
   props injetados em node/link customizados do Sankey */

function SankeyNodeShape(props: any) {
  const { x, y, width, height, payload } = props;
  const tx = x + width + 8;
  const clickable = !!payload.onSelect;
  // Sempre DUAS linhas: nome em cima (com reticências se preciso), valor + %
  // embaixo. O modo compacto de uma linha só cortava o valor na borda com
  // nomes longos e engolia o percentual — exatamente o defeito reportado.
  const name =
    payload.name.length > MAX_NAME ? `${payload.name.slice(0, MAX_NAME - 1)}…` : payload.name;
  const showDelta = typeof payload.delta === 'number' && Math.abs(payload.delta) >= 1;

  return (
    <Layer
      style={clickable ? { cursor: 'pointer' } : undefined}
      onClick={payload.onSelect}
    >
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload.color}
        radius={2}
        stroke={payload.selected ? '#5ee0a0' : undefined}
        strokeWidth={payload.selected ? 1.5 : 0}
      />
      {/* Área de toque generosa sobre o rótulo — a barra tem 10px de largura */}
      {clickable && <rect x={x} y={y - 6} width={190} height={height + 12} fill="transparent" />}
      <text
        x={tx}
        y={y + height / 2 - 2}
        textAnchor="start"
        fontFamily={FONT}
        fontSize={11}
        fontWeight={600}
        fill={payload.selected ? '#5ee0a0' : '#f5f4f2'}
        stroke="#1b1b1e"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {name}
      </text>
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
        {showDelta && <tspan> · </tspan>}
        {showDelta && (
          <tspan fill={payload.delta > 0 ? '#e05a4d' : '#34a873'}>
            {payload.delta > 0 ? '▲' : '▼'}
            {Math.abs(payload.delta).toFixed(0)}%
          </tspan>
        )}
      </text>
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
 * Superávit sai pela direita como RESULTADO LÍQUIDO (primeira linha dos
 * destinos); déficit entra pela esquerda como USO DE RESERVAS, ordenado por
 * tamanho entre as fontes. Sankey não representa fluxo negativo — é assim que
 * o diagrama fecha, e é o que de fato acontece com o dinheiro.
 *
 * SINAL das categorias: saldo POSITIVO é reembolso líquido — dinheiro que
 * voltou. Entra como fonte, nunca como destino.
 *
 * Com uma fonte só, o nó "Caixa" não é criado: seriam dois blocos gigantes
 * com o mesmo valor ocupando metade do card sem informação nenhuma.
 *
 * NÍVEL ÚNICO: o diagrama mostra só categorias-mãe. Abrir subcategoria aqui
 * dentro punha 8 folhas de "Compras" com nome cortado empurrando o resto do
 * desenho — e o painel de análise já dá a mesma quebra com nome inteiro,
 * valor, média e Δ. Clicar numa categoria abre lá.
 */
export function CashFlowSankey({
  income,
  balance,
  categories,
  unit = '',
  selectedId,
  onSelectCategory,
  averages,
}: Props) {
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

  // ---- Fontes, da maior para a menor ----
  // Déficit vira "Uso de reservas" (não é resultado líquido — é de onde veio
  // o que faltou) e entra ordenado por tamanho: abaixo de Receitas quando
  // menor, acima quando o buraco superar o que entrou.
  const sourceDefs: Array<{ name: string; color: string; value: number }> = [];
  if (income > 0) sourceDefs.push({ name: 'Receitas', color: MONEY.income, value: income });
  for (const c of inCats) {
    sourceDefs.push({ name: c.name, color: c.color || MONEY.income, value: c.value });
  }
  if (balance < 0) sourceDefs.push({ name: 'Uso de reservas', color: MONEY.expense, value: -balance });
  sourceDefs.sort((a, b) => b.value - a.value);

  const sources = sourceDefs.map((s) => ({ idx: node(s.name, s.color, s.value), value: s.value }));

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

  // Δ vs média 12M: responde "está acima ou abaixo do normal?" direto no nó.
  const deltaFor = (id: string, value: number): number | null => {
    const avg = averages?.get(id);
    return avg && avg > 0 ? ((value - avg) / avg) * 100 : null;
  };

  for (const c of outCats) {
    if (c.value / totalOut < MIN_SHARE) continue;
    const idx = node(c.name, c.color, c.value, {
      delta: deltaFor(c.id, c.value),
      ...(onSelectCategory
        ? { onSelect: () => onSelectCategory(c.id), selected: selectedId === c.id }
        : {}),
    });
    links.push({ source: hubIdx, target: idx, value: c.value });
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
          nodePadding={NODE_PADDING}
          margin={{ top: 12, right: 190, bottom: 12, left: 4 }}
          node={SankeyNodeShape}
          link={SankeyLinkShape}
          // Preserva a ordem de inserção no eixo vertical (o padrão reordena
          // por valor e jogava o Resultado líquido para o meio da lista). A
          // relaxação (iterations) fica LIGADA: com a expansão no lugar não
          // existe coluna extra para o layout brigar, e é ela que distribui
          // colunas esparsas com harmonia em vez de pinar tudo no topo.
          sort={false}
        />
      </ResponsiveContainer>
    </div>
  );
}
