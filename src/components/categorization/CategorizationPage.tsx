import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { usePublicCategorizationSession } from '../../hooks/useCategorizationSession';
import { CategorizationCard } from './CategorizationCard';
import { CheckCircle } from 'lucide-react';

export function CategorizationPage() {
  const { token } = useParams<{ token: string }>();
  const { session, transactions, categories, loading, error, categorizeTransaction } =
    usePublicCategorizationSession(token || '');
  // Track position in the FULL list (including already categorized) using a cursor
  const [cursor, setCursor] = useState(0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-accent text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
        <div className="bg-bg-card border border-border rounded-lg p-6 text-center max-w-sm">
          <div className="text-3xl mb-3">😕</div>
          <h2 className="text-text-primary text-sm font-bold mb-2">Ops!</h2>
          <p className="text-text-secondary text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!session || transactions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
        <div className="bg-bg-card border border-border rounded-lg p-6 text-center max-w-sm">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-text-secondary text-xs">Nenhuma transacao para categorizar.</p>
        </div>
      </div>
    );
  }

  const uncategorized = transactions.filter((t) => !t.categoryId);
  const categorizedCount = transactions.length - uncategorized.length;
  const allDone = uncategorized.length === 0;

  // Find the next uncategorized transaction starting from cursor position
  function findNextUncategorized(from: number): number {
    // Search forward from cursor
    for (let i = from; i < transactions.length; i++) {
      if (!transactions[i].categoryId) return i;
    }
    // Wrap around
    for (let i = 0; i < from; i++) {
      if (!transactions[i].categoryId) return i;
    }
    return -1;
  }

  const currentFullIndex = findNextUncategorized(cursor);
  const currentTx = currentFullIndex >= 0 ? transactions[currentFullIndex] : null;

  async function handleCategorize(categoryId: string, notes: string) {
    if (!currentTx) return;
    await categorizeTransaction(currentTx.id, categoryId, notes);
    // Move cursor forward to find the next uncategorized
    setCursor(currentFullIndex + 1);
  }

  function handleSkip() {
    // Find the next uncategorized AFTER the current one
    const next = findNextUncategorized(currentFullIndex + 1);
    if (next >= 0) setCursor(next);
  }

  function handleBack() {
    // Find the previous uncategorized BEFORE the current one
    for (let i = currentFullIndex - 1; i >= 0; i--) {
      if (!transactions[i].categoryId) {
        setCursor(i);
        return;
      }
    }
    // Wrap around from end
    for (let i = transactions.length - 1; i > currentFullIndex; i--) {
      if (!transactions[i].categoryId) {
        setCursor(i);
        return;
      }
    }
  }

  // Can go back if there's more than 1 uncategorized
  const canGoBack = uncategorized.length > 1;

  if (allDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
        <div className="bg-bg-card border border-border rounded-lg p-8 text-center max-w-sm space-y-4">
          <CheckCircle size={48} className="text-accent-green mx-auto" />
          <h2 className="text-text-primary text-lg font-bold">Tudo categorizado!</h2>
          <p className="text-text-secondary text-xs">
            Voce categorizou {categorizedCount} transacoes. Pode fechar esta pagina.
          </p>
          <div className="text-[10px] text-text-secondary">
            {session.titularName && `Titular: ${session.titularName}`}
          </div>
        </div>
      </div>
    );
  }

  if (!currentTx) return null;

  return (
    <div
      className="fixed inset-0 bg-bg-primary flex flex-col overflow-hidden"
      onTouchStart={(e) => {
        // Dismiss keyboard when tapping outside input/textarea on iOS
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }
      }}
    >
      {/* Header */}
      <header className="bg-bg-secondary border-b border-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-accent text-xs font-bold tracking-wider">CATEGORIZAR GASTOS</h1>
            {session.titularName && (
              <p className="text-text-secondary text-[10px]">{session.titularName}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-accent text-sm font-bold">
              {categorizedCount}/{transactions.length}
            </div>
            <div className="text-text-secondary text-[10px]">categorizados</div>
          </div>
        </div>
      </header>

      {/* Progress bar */}
      <div className="bg-bg-secondary">
        <div className="max-w-lg mx-auto">
          <div className="h-1 bg-border">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(categorizedCount / transactions.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-3 pt-4 pb-[env(safe-area-inset-bottom)] min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="w-full max-w-sm">
          <CategorizationCard
            transaction={currentTx}
            categories={categories}
            onCategorize={handleCategorize}
            onSkip={handleSkip}
            onBack={canGoBack ? handleBack : undefined}
            remaining={uncategorized.length}
          />
        </div>
      </div>
    </div>
  );
}
