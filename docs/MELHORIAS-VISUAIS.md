# Melhorias visuais — auditoria de interface com código

**Data:** 02/07/2026 · **Status:** proposta para revisão (nada implementado) · **Complementa:** `PLANO-DE-MELHORIAS.md` (D4) e `prototipos/categorizacao-mobile.html`

Direção declarada pelo dono: **fluidez, leveza, confiabilidade, robustez e elegância** — referência Apple/Linear/Revolut. Este documento traz (1) o diagnóstico do sistema visual atual com evidências, (2) os tokens de design **em código pronto**, (3) receitas de componentes antes/depois, (4) o novo tema de gráficos **validado por script** para daltonismo e contraste, e (5) melhorias tela a tela.

---

## 1. Diagnóstico do sistema visual atual

| # | Achado | Evidência | Impacto |
|---|---|---|---|
| V1 | **A fonte do app inteiro é monoespaçada — e nem carrega.** `--font-mono: 'JetBrains Mono', 'Fira Code', ...` é a fonte do `body`, mas não existe `@font-face` nem link de fonte no projeto. Todo dispositivo cai no fallback `monospace` genérico (iPhone → Courier). | `index.css:13,20`; `index.html` (sem fonte); `chartTheme.ts:27` | A tipografia do app é o acaso de cada aparelho. Estética "terminal", oposta à direção de elegância. |
| V2 | **Accent âmbar** `#f59e0b` como cor de marca/ação. | `index.css:8` | Conflita com a nova identidade (verde-menta do protótipo aprovado). Âmbar também colide com o semáforo de "atenção" nas metas. |
| V3 | **Tipografia minúscula e sem escala**: 357× `text-xs` (12px), 159× `text-[10px]`, 31× `text-[11px]`, 7× `text-[9px]`. Valores arbitrários em px espalhados. | inventário via grep em `src/components/` | Leitura cansativa, hierarquia fraca, impossível ajustar globalmente. 9–10px está abaixo de qualquer piso de legibilidade. |
| V4 | **Raio de canto inconsistente**: 193× `rounded` (4px), 79× `rounded-lg` (8px), 8× `rounded-xl`, 1× `rounded-md`, 1× `rounded-sm`. | inventário via grep | Cada superfície parece de um app diferente. A direção aprovada usa 12–16px. |
| V5 | **Cores hex hardcoded em componentes** (9× `#737373`, 4× `#111111`, série de cores de gráfico repetidas inline). | inventário via grep | Mudança de tema exige caça manual; garantia de divergência com o tempo. |
| V6 | **Paleta de gráficos arco-íris**, 10 matizes ciclados por índice. | `chartTheme.ts:1-12` | Cores por posição (não por entidade), sem validação de daltonismo, visual de planilha. |
| V7 | **Números sem alinhamento tabular** — nenhum uso de `tabular-nums`; o alinhamento hoje depende da fonte mono (que nem carrega). | grep sem ocorrências | Ao migrar para sans, colunas de valores desalinham se não adotar `font-variant-numeric`. |
| V8 | **Pontos positivos a preservar**: ícones já são lucide (linha, peso uniforme) em nav e categorias; sidebar com estado ativo claro; dark mode como base. | `Layout.tsx:4-18`, `CategoryIcon.tsx` | A migração de ícones já está feita — o problema visual não são os ícones. |

---

## 2. Tokens de design (código pronto — substitui o `@theme` do `index.css`)

Um único lugar define o sistema. Tailwind 4 gera as classes a partir daqui (`bg-surface`, `text-ink-2`, `rounded-card`...).

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* Superfícies (do fundo ao 1º plano) */
  --color-bg: #0d0d0f;            /* plano da página */
  --color-surface: #121212;       /* áreas de conteúdo */
  --color-card: #1b1b1e;          /* cartões */
  --color-elevated: #232327;      /* hover, inputs, chips */
  --color-border: #2a2a2e;        /* hairline */

  /* Texto (3 níveis — nunca mais que isso) */
  --color-ink: #f5f4f2;           /* primário */
  --color-ink-2: #a3a29e;         /* secundário */
  --color-ink-3: #6e6d69;         /* mudo: labels, eixos */

  /* Ação e semântica de dinheiro (UI, não gráficos) */
  --color-accent: #5ee0a0;        /* menta — única cor de ação */
  --color-accent-dim: rgba(94, 224, 160, 0.32);
  --color-positive: #5ee0a0;      /* receita / ok */
  --color-negative: #ff6e5f;      /* despesa / destrutivo */

  /* Status de metas (semáforo — reservado, nunca vira "série 4" de gráfico) */
  --color-status-ok: #5ee0a0;
  --color-status-warn: #fab219;
  --color-status-over: #ff6e5f;

  /* Raios (2 tamanhos, ponto final) */
  --radius-card: 16px;
  --radius-control: 12px;

  /* Tipografia: sans do sistema (a mesma do iPhone/Mac), sem fonte externa */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;

  /* Escala tipográfica (única fonte de tamanhos — apaga os text-[10px]) */
  --text-caption: 11px;   /* labels uppercase, eixos */
  --text-body: 13px;      /* corpo padrão, tabelas */
  --text-title: 15px;     /* títulos de card */
  --text-kpi: 28px;       /* número-herói */
}

body {
  margin: 0;
  background-color: var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* Números alinhados em colunas — substitui o papel da fonte mono */
.tnum { font-variant-numeric: tabular-nums; }

/* Foco visível (acessibilidade) */
:focus-visible { outline: 2px solid var(--color-accent-dim); outline-offset: 2px; }

/* Scrollbar fina */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--color-surface); }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }

/* Movimento contido por padrão */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Regras de uso (o que mantém a elegância):
- **Uma cor de ação** (menta). Âmbar deixa de existir como accent; vira só `status-warn`.
- **Números em UI sempre com `.tnum`** e alinhados à direita em tabelas.
- **Hairline em tudo**: bordas de 1px `--color-border`; profundidade vem de sobreposição de superfícies, não de sombras pesadas.
- **Movimento**: só `transform`/`opacity`, 200–300ms, `ease-out`. Nada anima "porque sim" — animação comunica consequência de um toque.

---

## 3. Receitas de componentes (antes → depois)

### 3.1 Botões
```tsx
// ANTES (padrão atual espalhado):
// className="px-3 py-1.5 bg-accent text-black text-xs rounded hover:bg-accent/80"

// DEPOIS — 3 variantes, altura mínima 36px desktop / 44px mobile:
const btn = {
  primary:   "inline-flex items-center gap-2 px-4 py-2 rounded-control bg-accent text-black text-body font-semibold hover:bg-accent/90 active:scale-[0.98] transition",
  secondary: "inline-flex items-center gap-2 px-4 py-2 rounded-control bg-card border border-border text-ink text-body font-medium hover:bg-elevated transition",
  ghost:     "inline-flex items-center gap-2 px-3 py-2 rounded-control text-ink-2 text-body hover:text-ink hover:bg-card transition",
  danger:    "inline-flex items-center gap-2 px-4 py-2 rounded-control bg-negative/10 border border-negative/40 text-negative text-body font-semibold hover:bg-negative/15 transition",
};
```

### 3.2 Card e KPI tile (o "sinal vital" do Dashboard)
```tsx
// Card base
<section className="bg-card border border-border rounded-card p-5">
  <header className="flex items-center justify-between mb-4">
    <h3 className="text-title font-semibold tracking-tight">Resultados de caixa</h3>
    {/* ações do card: ghost, ícone 16px */}
  </header>
  {/* conteúdo */}
</section>

// KPI tile — hierarquia: rótulo mudo → número herói → delta com sinal + seta (nunca só cor)
<div className="bg-card border border-border rounded-card p-5">
  <p className="text-caption uppercase tracking-[0.12em] text-ink-3 font-semibold">Taxa de poupança</p>
  <p className="text-kpi font-bold tnum mt-1">18,4%</p>
  <p className="text-body text-ink-2 mt-1 flex items-center gap-1">
    <ArrowUpRight size={14} className="text-positive" />
    <span className="text-positive font-medium">+2,1 pt</span> vs. média 6M
  </p>
</div>
```

### 3.3 Tabela de transações
```tsx
// Cabeçalho: caption uppercase mudo; células: 13px; valores à direita com .tnum
<th className="text-caption uppercase tracking-[0.1em] text-ink-3 font-semibold text-left px-3 py-2">Descrição</th>
<tr className="border-b border-border hover:bg-elevated/50 transition-colors">
  <td className="px-3 py-2.5 text-body">PADARIA STELLA</td>
  <td className="px-3 py-2.5 text-body text-ink-2">28/06</td>
  <td className="px-3 py-2.5 text-body text-right tnum text-negative">−R$ 34,90</td>
</tr>
// Regras: linha 40px de altura (denso mas respirável); receitas em `text-positive`,
// despesas em `text-negative` SÓ na coluna de valor — o resto da linha fica neutro.
```

### 3.4 Chips de estado (fatura aberta/fechada, conciliado) — ícone + texto, nunca só cor
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-elevated border border-border text-caption font-semibold text-ink-2">
  <LockOpen size={12} /> Aberta
</span>
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 border border-accent-dim text-caption font-semibold text-accent">
  <Lock size={12} /> Fechada
</span>
```

### 3.5 Barra de meta (3 estados semânticos, com rótulo textual)
```tsx
const tone = pct >= 100 ? "bg-status-over" : pct >= 80 ? "bg-status-warn" : "bg-status-ok";
<div className="h-1.5 rounded-full bg-elevated overflow-hidden">
  <div className={`h-full rounded-full ${tone} transition-[width] duration-300`} style={{ width: `${Math.min(pct, 100)}%` }} />
</div>
<p className="text-caption text-ink-2 mt-1 tnum">
  {pct >= 100 ? `Excedeu em R$ ${fmt(over)}` : `${pct}% da meta · resta R$ ${fmt(rest)}`}
</p>
```

### 3.6 Inputs
```tsx
"w-full bg-elevated border border-border rounded-control px-3.5 py-2.5 text-body text-ink placeholder:text-ink-3 focus:border-accent-dim outline-none transition-colors"
```

### 3.7 Item de navegação (sidebar)
```tsx
// Substitui o border-l-2 âmbar por pílula preenchida (mais Apple, menos "admin template")
cn(
  "flex items-center gap-3 px-3 py-2 rounded-control text-body font-medium transition-colors",
  isActive ? "bg-accent/10 text-accent" : "text-ink-2 hover:text-ink hover:bg-card"
)
```

---

## 4. Tema de gráficos — **paleta validada por script** (não a olho)

Validação executada com o validador de paleta (banda de luminosidade OKLCH, piso de croma, separação para daltonismo protan/deutan/tritan, contraste ≥3:1) contra a superfície real dos cards (`#1b1b1e`). Resultados: **todos os checks passam**.

- Par semântico para marcas de gráfico: `#34a873` / `#e05a4d` — ΔE deutan 15,4; contraste ok; dentro da banda.
- Categórica (6 matizes, ordem fixa): pior par adjacente ΔE 23,7 (deutan) — bem acima do alvo ≥12.

> Nota: o menta `#5ee0a0` e o coral `#ff6e5f` da UI são **claros demais para marcas de gráfico** (falharam a banda de luminosidade na validação). Por isso os gráficos usam degraus mais profundos dos mesmos matizes — mesma identidade, legibilidade correta.

```ts
// src/lib/chartTheme.ts — substituto completo
/** Semântica de dinheiro nos gráficos (degraus profundos dos matizes da UI). */
export const MONEY = {
  income: '#34a873',    // receita
  expense: '#e05a4d',   // despesa
  balance: '#3987e5',   // resultado/linha neutra
};

/**
 * Categórica: 6 matizes em ORDEM FIXA + "Outros".
 * Regras: nunca ciclar além de 6 — agregue o resto em "Outros" (OTHER);
 * a cor segue a ENTIDADE (uma categoria mantém sua cor em todos os meses,
 * filtros e telas — mapeie categoryId → slot uma vez, não por índice do gráfico).
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

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

export const AXIS_STYLE = {
  tick: { fill: '#6e6d69', fontSize: 11, fontFamily: FONT },
  axisLine: { stroke: '#2a2a2e' },
  tickLine: false as const,
};

export const GRID_STYLE = {
  stroke: '#232327',        // hairline recessivo, sem dash (menos ruído)
  vertical: false as const, // só linhas horizontais
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
```

Especificação das marcas (aplicar nos componentes Recharts):
- **Barras**: finas, topo arredondado 4px (`radius={[4,4,0,0]}`), gap de 2px entre barras adjacentes/segmentos empilhados; receita/despesa usam `MONEY`, nunca a categórica.
- **Linhas**: `strokeWidth={2}`, sem dots exceto o último ponto enfatizado (`activeDot` r=4).
- **Rótulos**: seletivos (último ponto, maior fatia) — nunca um número em cada ponto; valores em `tabular-nums`.
- **Legenda**: presente com ≥2 séries; 1 série não tem legenda (o título nomeia).
- **Heatmap de evolução** (`CategoryEvolutionReport`): rampa **sequencial de um matiz** (azul `#cde2fb → #0d366b` invertida para dark), não intensidade da cor da própria categoria por linha — hoje cada linha tem uma escala diferente, impossibilitando comparação entre linhas.
- **"Despesas por categoria"**: com >6 fatias, donut vira ilegível — usar **barras horizontais** top-6 + "Outros" (mesma informação, leitura direta). Máximo 6 cores + cinza.

---

## 5. Melhorias tela a tela

| Tela | Melhorias (em ordem de impacto) |
|---|---|
| **Dashboard** | 1) Abrir com a **linha de sinais vitais** (KPI tiles §3.2): taxa de poupança, resultado do mês, projeção de fim de mês, metas em risco — antes de qualquer gráfico. 2) Unificar cabeçalhos de card (`text-title` + ação ghost à direita). 3) YoY: colapsar o drill-down por padrão (progressive disclosure) — o painel de 870 linhas de código entrega tudo de uma vez. |
| **Transações** | 1) Corpo da tabela de 10px → 13px (`text-body`), altura de linha 40px. 2) Valores à direita com `.tnum`, cor semântica só na coluna de valor. 3) Cabeçalho sticky. 4) Filtros ativos como chips removíveis (padrão §3.4). 5) Barra de ações em lote fixa no rodapé quando há seleção (hoje se perde no topo). |
| **Cartões** | 1) Chips Aberta/Fechada com ícone+texto (§3.4). 2) "Valor a pagar" como número-herói do painel da fatura (`text-kpi`), o resto recua. 3) Dots de conciliação → checkbox com rótulo acessível. |
| **Relatórios** | 1) Heatmap com rampa sequencial única (§4). 2) Tabelas com `.tnum` e zebra sutil (`odd:bg-elevated/30`). 3) Percentuais com barra inline (micro data-viz) em vez de célula de texto. |
| **Metas** | 1) Barra de 3 estados com rótulo textual (§3.5). 2) Resumo do mês no topo (total meta vs. realizado) como KPI tile. 3) Ordenar por % consumido desc por padrão (o que precisa de atenção primeiro). |
| **Configurações** | Dividir em seções navegáveis (Família · Contas · Cartões · Chave API · Backup); hoje são 623 linhas numa coluna só. Ações destrutivas (restaurar backup) em zona separada com moldura `--color-negative`. |
| **Login** | Aplicar tokens; logotipo tipográfico simples em menta; um único card centrado. |
| **Categorização (esposa)** | Já especificada no protótipo `prototipos/categorizacao-mobile.html` — é a referência da direção para o app todo. |
| **Transversal** | 1) **Empty states desenhados** (ícone de linha 24px mudo + 1 frase + ação primária) em toda lista vazia. 2) **Skeletons** (blocos `bg-elevated` pulsando) em toda tela com `loading`. 3) `:focus-visible` em tudo que é interativo. 4) Touch targets ≥44px no mobile. 5) `theme-color` do `index.html` atualizado para `#0d0d0f`. |

---

## 6. Estratégia de migração (sem big-bang)

1. **Commit 1 — tokens**: novo `index.css` com aliases de compatibilidade temporários (`--color-bg-primary: var(--color-bg)` etc.) para nada quebrar; troca de `chartTheme.ts`. App inteiro muda de fonte/accent num commit reversível.
2. **Commit 2 — componentes compartilhados**: botões, chips, inputs, tabela (arquivo `src/components/shared/ui.ts` com as receitas §3 como constantes).
3. **Commits 3..n — uma tela por vez**, na ordem: Dashboard → Transações → Cartões → Metas → Relatórios → Configurações, removendo os aliases ao final.
4. Cada commit é visualmente verificável no preview do Cloudflare Pages antes do próximo.

**Peso**: zero dependências novas (a fonte é a do sistema; ícones já são lucide; animações são CSS puro). O bundle tende a **diminuir** (remoção da paleta rainbow inline e das fontes fantasma).
