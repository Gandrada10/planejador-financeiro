/**
 * Classes dos controles da aba Projetos, num lugar só.
 *
 * A barra de ações do projeto é montada em DOIS arquivos — os botões de ciclo
 * de vida (editar/encerrar/excluir) nascem na página, que é quem sabe mexer no
 * cadastro, e os de dados (CSV/abrir em Transações) no painel de detalhe — mas
 * eles aparecem lado a lado na MESMA linha do cabeçalho. Com a classe escrita
 * duas vezes, qualquer ajuste de altura ou de padding desalinhava um grupo em
 * relação ao outro.
 */

/** Botão secundário da barra de ações (contorno hairline, menta no hover). */
export const control =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-body rounded-control border border-border ' +
  'text-text-secondary transition-colors hover:border-accent hover:text-accent ' +
  'disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary';

/** Variante de risco: hover coral (encerrar, excluir). */
export const controlDanger =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-body rounded-control border border-border ' +
  'text-text-secondary transition-colors hover:border-accent-red/60 hover:text-accent-red';

/** Ação primária da tela (uma por tela: "Novo projeto"). */
export const controlPrimary =
  'inline-flex items-center gap-1.5 px-3.5 py-2 text-body font-bold rounded-control ' +
  'bg-accent text-bg-primary transition-opacity hover:opacity-90';

/** Rótulo de seção: caption em caixa alta, o padrão do app para "onde estou". */
export const sectionLabel =
  'text-caption font-semibold uppercase tracking-wider text-ink-3';
