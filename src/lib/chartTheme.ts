// Tema de gráficos — paleta validada por script (banda de luminosidade OKLCH,
// piso de croma, separação para daltonismo protan/deutan/tritan e contraste
// >=3:1) contra a superfície escura real dos cards (#1b1b1e).
// Ver docs/MELHORIAS-VISUAIS.md §4.

/**
 * Semântica de dinheiro nos gráficos. Degraus mais PROFUNDOS dos matizes da UI:
 * o menta/coral da interface (#5ee0a0/#ff6e5f) são claros demais para marcas de
 * gráfico (falham a banda de luminosidade) — aqui usamos a mesma identidade em
 * tom legível. Receita/despesa/resultado usam SEMPRE estes, nunca a categórica.
 */
export const MONEY = {
  income: '#34a873',   // receita
  expense: '#e05a4d',  // despesa
  balance: '#3987e5',  // resultado / linha neutra
};

/**
 * Paleta categórica: 6 matizes em ORDEM FIXA + "Outros".
 * Regras:
 *  - nunca ciclar além de 6 — agregue o excedente em "Outros" (OTHER_COLOR);
 *  - a cor segue a ENTIDADE, não a posição: mapeie categoryId -> slot uma única
 *    vez (colorForCategory) para que uma categoria mantenha a mesma cor em todos
 *    os meses, filtros e telas.
 * Validação (dark, superfície #1b1b1e): pior par adjacente ΔE 23,7 (deutan),
 * bem acima do alvo >=12; todos >=3:1 de contraste.
 */
export const CHART_COLORS = [
  '#3987e5', // azul
  '#199e70', // verde-mar
  '#c98500', // âmbar profundo
  '#9085e9', // violeta
  '#e66767', // vermelho suave
  '#d55181', // magenta
];

export const OTHER_COLOR = '#6e6d69';

/**
 * Mapeia uma lista de ids de entidade (ex.: categorias) para cores estáveis.
 * As 6 primeiras entidades recebem os 6 slots; da 7ª em diante, OTHER_COLOR.
 * Use o MESMO ordering em todas as telas (ex.: ordene por total desc uma vez).
 */
export function buildColorMap(ids: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  ids.forEach((id, i) => {
    map[id] = i < CHART_COLORS.length ? CHART_COLORS[i] : OTHER_COLOR;
  });
  return map;
}

export const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

export const AXIS_STYLE = {
  tick: { fill: '#6e6d69', fontSize: 11, fontFamily: FONT },
  axisLine: { stroke: '#2a2a2e' },
  tickLine: false as const,
};

export const GRID_STYLE = {
  stroke: '#232327',         // hairline recessivo, sem tracejado (menos ruído)
  vertical: false as const,  // só linhas horizontais
};

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#232327',
    border: '1px solid #2a2a2e',
    borderRadius: 12,
    fontSize: 12,
    color: '#f5f4f2',
    fontFamily: FONT,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  itemStyle: { color: '#f5f4f2' },
  labelStyle: { color: '#a3a29e', marginBottom: 4 },
};
