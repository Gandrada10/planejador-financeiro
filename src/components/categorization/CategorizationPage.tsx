import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { usePublicCategorizationSession } from '../../hooks/useCategorizationSession';
import { CategorizationCard } from './CategorizationCard';
import { Check, Undo2, Inbox } from 'lucide-react';

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
  const [undo, setUndo] = useState<{ txId: string; label: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

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

  const currentFullIndex = findNextUncategorized(cursor);
  const currentTx = currentFullIndex >= 0 ? transactions[currentFullIndex] : null;

  function showUndo(txId: string, label: string) {
    setUndo({ txId, label });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 4000);
  }

  async function handleCategorize(categoryId: string, notes: string) {
    if (!currentTx) return;
    const txId = currentTx.id;
    const label = categories.find((c) => c.id === categoryId)?.name ?? 'Categoria';
    await categorizeTransaction(txId, categoryId, notes);
    setCursor(currentFullIndex + 1);
    showUndo(txId, label);
  }

  function handleSkip() {
    const next = findNextUncategorized(currentFullIndex + 1);
    if (next >= 0) setCursor(next);
  }

  async function handleUndo() {
    if (!undo) return;
    const idx = transactions.findIndex((t) => t.id === undo.txId);
    await uncategorizeTransaction(undo.txId);
    if (idx >= 0) setCursor(idx);
    setUndo(null);
  }

  const greet = firstName(session.titularName);

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

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-3 pb-[env(safe-area-inset-bottom)] min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="w-full max-w-lg pb-4">
          <CategorizationCard
            transaction={currentTx}
            categories={categories}
            quickCategoryIds={session.topCategoryIds}
            onCategorize={handleCategorize}
            onSkip={handleSkip}
            remaining={uncategorized.length}
          />
        </div>
      </div>

      {/* Toast desfazer */}
      {undo && (
        <div className="fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 flex justify-center">
          <div className="w-full max-w-lg flex items-center justify-between gap-3 bg-elevated border border-border rounded-full px-4 py-2.5 shadow-lg">
            <span className="text-body text-text-secondary truncate">
              Marcado como <b className="text-accent font-semibold">{undo.label}</b>
            </span>
            <button
              onClick={handleUndo}
              className="flex items-center gap-1.5 text-body font-semibold text-text-primary whitespace-nowrap"
            >
              <Undo2 size={15} /> Desfazer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
