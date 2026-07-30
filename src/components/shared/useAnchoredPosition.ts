import { useLayoutEffect, type RefObject } from 'react';

interface Options {
  open: boolean;
  /** Elemento que ancora o pop-up (o gatilho clicado). */
  anchorRef: RefObject<HTMLElement | null>;
  /** O pop-up em si — precisa estar montado para ser MEDIDO. */
  popRef: RefObject<HTMLElement | null>;
  /** Largura fixa em px. Sem isso, acompanha a largura do gatilho. */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Respiro entre gatilho e pop-up. */
  gap?: number;
  /** Respiro mínimo até a borda da janela. */
  margin?: number;
}

/**
 * Ancora um pop-up (renderizado em PORTAL, `position: fixed`) no seu gatilho,
 * escolhendo o lado que caiba na tela.
 *
 * ── Por que não `absolute` no elemento pai ─────────────────────────────────
 * A tabela de lançamentos rola dentro da própria caixa (`overflow: auto`), e um
 * filho posicionado por `absolute` é RECORTADO por esse contêiner. Na última
 * linha da lista, o dropdown de categoria aparecia com uma opção e meia e a
 * caixa de anotação sumia embaixo da borda; ao focar o campo escondido, o
 * navegador ainda rolava a página inteira atrás dele — o "a tela toda sobe".
 * Em portal + fixed, o pop-up não pertence a nenhuma caixa que o recorte.
 *
 * ── O que decide ───────────────────────────────────────────────────────────
 * Mede a altura REAL do pop-up já montado e o coloca abaixo do gatilho quando
 * cabe, acima quando não cabe e sobra mais espaço em cima. Limita a altura ao
 * espaço do lado escolhido, para o conteúdo rolar por dentro quando nenhum dos
 * dois lados basta (celular na horizontal, teclado aberto).
 *
 * ── Por que escreve no DOM em vez de devolver coordenadas ──────────────────
 * Guardar a posição em estado exigiria um setState dentro do próprio efeito que
 * mede — um render a mais por abertura e uma cascata a cada mudança de conteúdo.
 * Posição de pop-up é sincronização com o DOM, que é o caso em que o efeito
 * deve escrever direto no elemento. Como `useLayoutEffect` roda ANTES da
 * pintura, o pop-up nunca aparece no lugar errado.
 *
 * Sem lista de dependências de propósito: roda a cada render enquanto aberto,
 * então acompanha conteúdo que cresce ou encolhe (a lista do combobox sendo
 * filtrada) sem precisar avisar o hook.
 */
export function useAnchoredPosition({
  open, anchorRef, popRef, width, minWidth = 0, maxWidth = Infinity, gap = 4, margin = 8,
}: Options): void {
  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;

      const a = anchor.getBoundingClientRect();
      // visualViewport = o que sobrou de tela ÚTIL. Com o teclado do iPhone
      // aberto, `innerHeight` continua contando a área coberta por ele, e
      // `offsetTop/offsetLeft` dizem onde a faixa visível começa depois de o
      // Safari deslocar a página. É o que mantém a caixa de anotação acima do
      // teclado no iPad/iPhone em vez de embaixo dele.
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const vTop = vv?.offsetTop ?? 0;
      const vLeft = vv?.offsetLeft ?? 0;

      const w = Math.min(maxWidth, Math.max(minWidth, width ?? a.width));
      const h = pop.offsetHeight;

      const roomBelow = vTop + vh - a.bottom - gap - margin;
      const roomAbove = a.top - vTop - gap - margin;
      // Só sobe se não couber embaixo E houver mais espaço em cima: abrir para
      // baixo continua sendo a regra.
      const above = h > roomBelow && roomAbove > roomBelow;

      // Nenhum dos dois lados serve (celular com teclado aberto, que come mais
      // da metade da tela): em vez de insistir na âncora e ficar embaixo do
      // teclado, ocupa a faixa visível inteira, como um diálogo.
      if (Math.max(roomBelow, roomAbove) < 160) {
        pop.style.width = `${w}px`;
        pop.style.maxHeight = `${Math.max(120, vh - 2 * margin)}px`;
        pop.style.top = `${vTop + margin}px`;
        pop.style.left = `${Math.max(vLeft + margin, Math.min(a.left, vLeft + vw - w - margin))}px`;
        return;
      }

      // Piso de 120px: numa janela muito baixa, melhor um pop-up com rolagem
      // interna do que um de 20px de altura.
      const maxHeight = Math.max(120, Math.floor(above ? roomAbove : roomBelow));

      pop.style.width = `${w}px`;
      pop.style.maxHeight = `${maxHeight}px`;
      pop.style.top = `${above
        ? Math.max(vTop + margin, a.top - gap - Math.min(h, maxHeight))
        : a.bottom + gap}px`;
      pop.style.left = `${Math.max(vLeft + margin, Math.min(a.left, vLeft + vw - w - margin))}px`;
    }

    place();
    // Girar a tela, abrir o teclado ou o Safari deslocar a faixa visível muda o
    // espaço disponível: reposiciona em vez de deixar o pop-up pela metade fora
    // da tela (ou embaixo do teclado).
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  });
}
