import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { usePublicCategorizationSession } from '../../hooks/useCategorizationSession';
import { CategorizationCard } from './CategorizationCard';
import { Check, Undo2, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';

function firstName(name: string): string {
  const n = (name || '').trim();
  if (!n || n.toLowerCase() === 'todos') return '';
  return n.split(/\s+/)[0];
}

export function CategorizationPage() {
  const { token } = useParams<{ token: string }>();
  const { session, transactions, categories, loading, error, categorizeTransaction, uncategorizeTransaction } =
    usePublicCategorizationSession(token || '');
  const [cursor, setCursor] = useState(0);
  // navIndex sobrepõe o ponteiro de pendências quando o usuário navega à mão
  // (Voltar/Avançar) para revisar um item. null = seguindo o próximo pendente.
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ txId: string; label: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const fwdBtnRef = useRef<HTMLButtonElement>(null);

  if (loading) {
    return (
      <div className="h-[100dvh] bg-bg-primary flex flex-col p-4 gap-3">
        <div className="h-16 rounded-card bg-bg-card animate-pulse" />
        <div className="h-1.5 rounded-full bg-bg-card animate-pulse" />
        <div className="h-44 rounded-card bg-bg-card animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-control bg-bg-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg-primary p-4">
        <div className="bg-bg-card border border-border rounded-card p-8 text-center max-w-sm">
          <h2 className="text-text-primary text-title font-bold mb-2">Link indisponível</h2>
          <p className="text-text-secondary text-body">{error}</p>
        </div>
      </div>
    );
  }

  if (!session || transactions.length === 0) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg-primary p-4">
        <div className="bg-bg-card border border-border rounded-card p-8 text-center max-w-sm">
          <Inbox size={40} className="text-ink-3 mx-auto mb-3" />
          <p className="text-text-secondary text-body">Nenhum lançamento para categorizar.</p>
        </div>
      </div>
    );
  }

  const uncategorized = transactions.filter((t) => !t.categoryId);
  const categorizedCount = transactions.length - uncategorized.length;
  const total = transactions.length;
  const allDone = uncategorized.length === 0;

  function findNextUncategorized(from: number): number {
    for (let i = from; i < transactions.length; i++) if (!transactions[i].categoryId) return i;
    for (let i = 0; i < from; i++) if (!transactions[i].categoryId) return i;
    return -1;
  }

  // Ponteiro do "caminho feliz": próximo pendente a partir do frontier (cursor).
  const pendingIndex = findNextUncategorized(cursor);
  // Índice de navegação explícito sobre a lista da sessão. Quando o usuário
  // navega à mão, navIndex manda; senão o card segue o próximo pendente (o
  // fluxo linear de quem só quer ir em frente fica idêntico ao de antes).
  const displayIndex = navIndex !== null ? navIndex : pendingIndex;
  const currentTx =
    displayIndex >= 0 && displayIndex < transactions.length ? transactions[displayIndex] : null;
  // Um item categorizado só aparece via navegação manual (o ponteiro de
  // pendências nunca aponta para um já-categorizado) → isso é "revisão".
  const isReviewing = !!currentTx?.categoryId;

  function goBack() {
    const target = displayIndex - 1;
    if (target < 0) return;
    setUndo(null);
    setNavIndex(target);
    // "Voltar" some no 1º item → move o foco para "Avançar" p/ não ficar órfão.
    if (target === 0) requestAnimationFrame(() => fwdBtnRef.current?.focus());
  }

  function goForward() {
    const target = displayIndex + 1;
    if (target > total - 1) return;
    setUndo(null);
    // Ao reencontrar o frontier de trabalho, reata o caminho feliz (navIndex null).
    setNavIndex(target === pendingIndex ? null : target);
    if (target === total - 1) requestAnimationFrame(() => backBtnRef.current?.focus());
  }

  // C7/undo robusto: 8s de janela (era 4s) — rede de segurança do ÚLTIMO item.
  // O "Voltar" é adicional; não substitui o undo.
  function showUndo(txId: string, label: string) {
    setUndo({ txId, label });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }

  async function handleCategorize(categoryId: string, notes: string) {
    if (!currentTx) return;
    const txId = currentTx.id;
    const wasCategorized = !!currentTx.categoryId;
    const label = categories.find((c) => c.id === categoryId)?.name ?? 'Categoria';
    await categorizeTransaction(txId, categoryId, notes);
    if (navIndex !== null) {
      // (Re)categorizou um item revisitado → volta ao ponto de trabalho (próximo
      // pendente do frontier). Retoma exatamente de onde havia parado.
      setNavIndex(null);
    } else {
      setCursor(displayIndex + 1);
    }
    // Undo só quando o item passou de pendente → categorizado. Numa TROCA
    // (categorizado → categorizado) "Desfazer" apagaria a categoria sem
    // restaurar a anterior; nesse caso a própria navegação é a rede.
    if (!wasCategorized) showUndo(txId, label);
  }

  function handleSkip() {
    const next = findNextUncategorized(displayIndex + 1);
    if (next >= 0) {
      setNavIndex(null);
      setCursor(next);
    }
  }

  async function handleUndo() {
    if (!undo) return;
    const idx = transactions.findIndex((t) => t.id === undo.txId);
    await uncategorizeTransaction(undo.txId);
    if (idx >= 0) {
      setNavIndex(null);
      setCursor(idx);
    }
    setUndo(null);
  }

  const greet = firstName(session.titularName);

  // C7: o toast precisa existir TAMBÉM na tela de celebração — antes, quando
  // o item categorizado era o último, o re-render caía na celebração antes do
  // JSX do toast e o desfazer ficava inalcançável. Alvo do botão ≥44px.
  const undoToast = undo ? (
    <div className="fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 flex justify-center">
      <div className="w-full max-w-lg flex items-center justify-between gap-3 bg-elevated border border-border rounded-full pl-4 pr-2 py-1.5 shadow-lg">
        <span className="text-body text-text-secondary truncate">
          Marcado como <b className="text-accent font-semibold">{undo.label}</b>
        </span>
        <button
          onClick={handleUndo}
          className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] px-3 text-body font-semibold text-text-primary whitespace-nowrap"
        >
          <Undo2 size={15} /> Desfazer
        </button>
      </div>
    </div>
  ) : null;

  if (allDone) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg-primary p-6">
        <div className="text-center max-w-sm flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-full bg-accent/10 border border-accent flex items-center justify-center">
            <Check size={36} className="text-accent" strokeWidth={2.5} />
          </div>
          <h2 className="text-text-primary text-2xl font-bold tracking-tight">Tudo categorizado!</h2>
          <p className="text-text-secondary text-body leading-relaxed">
            {categorizedCount} lançamento{categorizedCount !== 1 ? 's' : ''} pronto{categorizedCount !== 1 ? 's' : ''}.
            Está tudo salvo — pode fechar.{greet ? ` Obrigado, ${greet}! 💚` : ' 💚'}
          </p>
        </div>
        {undoToast}
      </div>
    );
  }

  if (!currentTx) return null;

  return (
    <div
      className="h-[100dvh] bg-bg-primary flex flex-col overflow-hidden"
      onTouchStart={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }
      }}
    >
      {/* Header + progresso */}
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-text-primary text-xl font-bold tracking-tight">
                {greet ? `Oi, ${greet}` : 'Categorização'}
              </h1>
              <p className="text-body text-text-secondary mt-0.5">
                {uncategorized.length} lançamento{uncategorized.length !== 1 ? 's' : ''} esperando por você
              </p>
            </div>
            <span className="text-body font-semibold text-text-secondary tnum whitespace-nowrap">
              {categorizedCount} de {total}
            </span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-bg-card overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${(categorizedCount / total) * 100}%` }}
            />
          </div>
        </div>
      </header>

      {/* Barra de topo: [ Voltar ] · Item X de Y · [ Pular / Avançar ]. O slot da
          direita é CONTEXTUAL — no fluxo normal (item do frontier ainda não
          categorizado) é "Pular" (avançar-sem-categorizar); ao VOLTAR para revisar
          um item já tratado vira "Avançar" (retoma o ponto onde estava). Assim o
          "Pular" fica ao lado do indicador, como pedido, sem perder a ida à frente.
          A posição ("Item X de Y") é distinta do PROGRESSO (a barra acima). */}
      <nav aria-label="Navegação entre lançamentos" className="px-4 pb-1">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-1.5">
          <button
            ref={backBtnRef}
            onClick={goBack}
            disabled={displayIndex <= 0}
            aria-label="Voltar ao lançamento anterior"
            className="min-h-[44px] px-2.5 -ml-1 inline-flex items-center gap-1 rounded-full text-body font-semibold text-text-secondary active:bg-elevated transition disabled:opacity-0 disabled:pointer-events-none"
          >
            <ChevronLeft size={18} aria-hidden="true" /> Voltar
          </button>
          <span className="text-caption font-semibold text-ink-3 tnum whitespace-nowrap text-center" aria-hidden="true">
            Item {displayIndex + 1} de {total}
            {isReviewing ? ' · revisando' : ''}
          </span>
          {isReviewing ? (
            <button
              ref={fwdBtnRef}
              onClick={goForward}
              disabled={displayIndex >= total - 1}
              aria-label="Avançar para o próximo lançamento"
              className="min-h-[44px] px-2.5 -mr-1 inline-flex items-center gap-1 rounded-full text-body font-semibold text-text-secondary active:bg-elevated transition disabled:opacity-0 disabled:pointer-events-none"
            >
              Avançar <ChevronRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button
              ref={fwdBtnRef}
              onClick={handleSkip}
              aria-label="Pular este lançamento sem categorizar"
              className="min-h-[44px] px-2.5 -mr-1 inline-flex items-center gap-1 rounded-full text-body font-semibold text-text-secondary active:bg-elevated transition"
            >
              Pular <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </nav>

      {/* Anúncio de posição/estado para leitores de tela ao mudar de card. */}
      <div aria-live="polite" className="sr-only">
        {`Lançamento ${displayIndex + 1} de ${total}. ${
          currentTx?.categoryId
            ? `Categorizado como ${categories.find((c) => c.id === currentTx.categoryId)?.name ?? 'categoria'}. Toque numa categoria para trocar.`
            : 'Ainda não categorizado.'
        }`}
      </div>

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-3 pb-[env(safe-area-inset-bottom)] min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="w-full max-w-lg pb-4">
          <CategorizationCard
            key={currentTx.id}
            transaction={currentTx}
            categories={categories}
            quickCategoryIds={session.topCategoryIds}
            onCategorize={handleCategorize}
            remaining={uncategorized.length}
          />
        </div>
      </div>

      {/* Toast desfazer */}
      {undoToast}
    </div>
  );
}
