/**
 * Faixa visível da tela em variáveis CSS — `--vv-top` e `--vv-height`.
 *
 * ── O problema ─────────────────────────────────────────────────────────────
 * O `index.html` já pede `interactive-widget=resizes-content`, que faz o
 * teclado virtual ENCOLHER o viewport de layout — é a solução certa e resolve
 * no Chrome/Android. O Safari do iPhone e do iPad ignora essa dica: lá o
 * teclado só encolhe o viewport VISUAL, então `100vh`, `inset-0` e todo
 * `position: fixed` continuam medindo a janela inteira. Consequência prática:
 * uma folha de nota ancorada embaixo (`items-end`) nasce atrás do teclado, e é
 * exatamente a caixa de texto que o dedo acabou de tocar que desaparece.
 *
 * ── A saída ────────────────────────────────────────────────────────────────
 * `window.visualViewport` conhece a faixa que sobrou: altura e deslocamento em
 * relação ao viewport de layout. Publicamos os dois em variáveis CSS no
 * elemento raiz, e a classe `.overlay-vv` (index.css) faz qualquer sobreposição
 * ocupar essa faixa em vez da janela inteira.
 *
 * Fora do iOS as variáveis simplesmente valem a janela toda e nada muda.
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  function apply() {
    const top = vv?.offsetTop ?? 0;
    const height = vv?.height ?? window.innerHeight;
    root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    root.style.setProperty('--vv-height', `${Math.round(height)}px`);
  }

  apply();
  if (!vv) return;
  // resize: teclado abrindo/fechando e rotação. scroll: o Safari desloca a
  // faixa visível dentro da página enquanto o teclado está aberto.
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
}
