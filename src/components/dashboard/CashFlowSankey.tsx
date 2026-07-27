import { Sankey, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { MONEY, OTHER_COLOR, FONT } from '../../lib/chartTheme';
import { formatBRL0 } from '../../lib/utils';

interface SubSlice {
  name: string;
  color: string;
  /** Negativo = despesa; positivo = reembolso líquido. */
  amount: number;
}

export interface CategorySlice extends SubSlice {
  subs: SubSlice[];
}

export type FlowLevel = 'parent' | 'sub';

interface Props {
  /** Receitas do mês (positivo). */
  income: number;
  /** Resultado do mês (receitas + despesas, sinal livre). */
  balance: number;
  categories: CategorySlice[];
  /** 'sub' abre uma quarta coluna com as subcategorias. */
  level: FlowLevel;
}

/**
 * Toda categoria ganha nó próprio. O piso existe só para o caso patológico
 * (uma categoria de R$ 2 no mês), que seria um fio invisível de qualquer jeito
 * — e o card CRESCE conforme o número de nós, em vez de cortar a lista.
 */
const MIN_SHARE = 0.003;
/** Espaço vertical reservado por nó da última coluna, para o rótulo caber. */
const ROW_SPACE = 32;

interface SankeyNodeDef {
  name: string;
  color: string;
  /** Fatia do caixa do mês, pré-computada (%) — evita closure no shape. */
  share: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts não tipa os
   props injetados em node/link customizados do Sankey */

// Rótulos sempre à DIREITA da barra: a coluna final escreve na margem
// reservada (margin.right) e as demais escrevem sobre o vão dos fluxos.
function SankeyNodeShape(props: any) {
  const { x, y, width, height, payload } = props;
  const tx = x + width + 8;
  const compact = height < 26;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} radius={2} />
      {/* Contorno na cor do card: no nível de subcategoria as fitas cruzam por
          cima dos rótulos das colunas do meio e os tornavam ilegíveis. */}
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
        {payload.name}
        {compact && (
          <tspan fontWeight={400} fill="#8f8e89">
            {' '}
            {formatBRL0(payload.value)}
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
          {payload.share !== null && ` · ${payload.share.toFixed(0)}%`}
        </text>
      )}
    </Layer>
  );
}

// Fita com gradiente da cor de origem para a de destino, como no Monarch.
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
 * Fluxo do dinheiro do mês (diagrama de Sankey, à la Monarch Money):
 *
 *   Receitas ─┐                ┌─ Moradia ─┬─ Aluguel
 *             ├─ Caixa do mês ─┤           └─ Condomínio
 *   Reserva ─┘                 └─ Sobra
 *
 * SINAL: uma categoria com saldo POSITIVO é reembolso líquido — dinheiro que
 * VOLTOU. Ela entra como fonte, nunca como destino; tratá-la por Math.abs()
 * a transformaria numa saída e o diagrama deixaria de fechar.
 *
 * "Da reserva" só aparece em mês deficitário (o que saiu além do que entrou
 * veio de algum lugar); "Sobra" só em mês superavitário. Com isso entradas =
 * saídas sempre — Sankey não representa fluxo negativo.
 */
export function CashFlowSankey({ income, balance, categories, level }: Props) {
  // Despesas de verdade (saídas) vs reembolsos líquidos (entradas).
  const outCats = categories
    .filter((c) => c.amount < 0)
    .map((c) => ({ ...c, value: -c.amount }))
    .sort((a, b) => b.value - a.value);
  const inCats = categories.filter((c) => c.amount > 0).map((c) => ({ ...c, value: c.amount }));

  const totalOut = outCats.reduce((s, c) => s + c.value, 0);
  if (totalOut === 0 && income <= 0) {
    return <p className="text-caption text-ink-3 text-center py-10">Sem movimento neste mês.</p>;
  }

  const inflow = income + inCats.reduce((s, c) => s + c.value, 0);
  // inflow − totalOut === balance, por construção.
  const available = Math.max(inflow, totalOut);
  const shareOf = (v: number) => (available > 0 ? (v / available) * 100 : null);

  const nodes: SankeyNodeDef[] = [];
  const links: Array<{ source: number; target: number; value: number }> = [];
  const push = (n: SankeyNodeDef) => nodes.push(n) - 1;

  // ---- Fontes ----
  const sources: Array<{ idx: number; value: number }> = [];
  if (income > 0) {
    sources.push({ idx: push({ name: 'Receitas', color: MONEY.income, share: shareOf(income) }), value: income });
  }
  for (const c of inCats) {
    sources.push({
      idx: push({ name: c.name, color: c.color || MONEY.income, share: shareOf(c.value) }),
      value: c.value,
    });
  }
  if (balance < 0) {
    sources.push({
      idx: push({ name: 'Da reserva', color: MONEY.expense, share: shareOf(-balance) }),
      value: -balance,
    });
  }

  const middleIdx = push({ name: 'Caixa do mês', color: MONEY.balance, share: null });
  for (const s of sources) links.push({ source: s.idx, target: middleIdx, value: s.value });

  // ---- Destinos ----
  const big = outCats.filter((c) => c.value / totalOut >= MIN_SHARE);
  const restTotal = totalOut - big.reduce((s, c) => s + c.value, 0);

  for (const c of big) {
    const parentIdx = push({ name: c.name, color: c.color, share: shareOf(c.value) });
    links.push({ source: middleIdx, target: parentIdx, value: c.value });

    if (level !== 'sub') continue;

    // Subcategorias: só divide quando os filhos cabem no pai. Se um sub tiver
    // saldo positivo (reembolso), a soma dos negativos pode passar do total do
    // pai — nesse caso o pai fica como folha, em vez de distorcer os valores.
    const subOut = c.subs
      .filter((s) => s.amount < 0)
      .map((s) => ({ ...s, value: -s.amount }))
      .filter((s) => s.value / totalOut >= 0.01)
      .sort((a, b) => b.value - a.value);
    const subSum = subOut.reduce((s, x) => s + x.value, 0);
    if (subOut.length === 0 || subSum > c.value + 0.01) continue;

    for (const s of subOut) {
      links.push({
        source: parentIdx,
        target: push({ name: s.name, color: s.color || c.color, share: shareOf(s.value) }),
        value: s.value,
      });
    }
    const remainder = c.value - subSum;
    if (remainder > totalOut * 0.005) {
      links.push({
        source: parentIdx,
        target: push({ name: `${c.name} · outros`, color: c.color, share: shareOf(remainder) }),
        value: remainder,
      });
    }
  }

  if (restTotal > 0.005) {
    links.push({
      source: middleIdx,
      target: push({
        name: `Outras (${outCats.length - big.length})`,
        color: OTHER_COLOR,
        share: shareOf(restTotal),
      }),
      value: restTotal,
    });
  }
  if (balance > 0) {
    links.push({
      source: middleIdx,
      target: push({ name: 'Sobra', color: MONEY.income, share: shareOf(balance) }),
      value: balance,
    });
  }

  // Altura pela COLUNA MAIS CHEIA (as folhas), não pelo total de nós: é ela
  // que precisa de espaço para os rótulos. Assim nenhuma categoria e cortada —
  // o card e que cresce.
  const sourceIdx = new Set(links.map((l) => l.source));
  const leafCount = nodes.filter((_, i) => !sourceIdx.has(i)).length;
  const height = Math.max(360, leafCount * ROW_SPACE);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodeWidth={10}
          nodePadding={14}
          margin={{ top: 12, right: 150, bottom: 12, left: 4 }}
          node={SankeyNodeShape}
          link={SankeyLinkShape}
        />
      </ResponsiveContainer>
    </div>
  );
}
