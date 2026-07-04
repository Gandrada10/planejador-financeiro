import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo destrutivo (vermelho + ícone de alerta) para ações irreversíveis. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmação acessível — substitui o `window.confirm()` nativo para
 * ações destrutivas. WCAG 2.2: role="dialog"/aria-modal, Esc fecha, foco preso
 * dentro e devolvido ao cancelar; o foco inicial cai no botão SEGURO (Cancelar).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? 'confirm-dialog-desc' : undefined}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-bg-card border border-border rounded-card p-5 flex flex-col gap-4"
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="shrink-0 mt-0.5 text-accent-red" aria-hidden="true">
              <AlertTriangle size={20} />
            </span>
          )}
          <div className="flex flex-col gap-1.5 min-w-0">
            <h2 id="confirm-dialog-title" className="text-title font-bold text-text-primary">
              {title}
            </h2>
            {message && (
              <p id="confirm-dialog-desc" className="text-body text-text-secondary leading-snug">
                {message}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-control border border-border text-body font-semibold text-text-primary hover:bg-bg-secondary transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`min-h-[44px] px-4 rounded-control text-body font-bold transition-colors ${
              destructive
                ? 'bg-accent-red text-bg-primary hover:opacity-90'
                : 'bg-accent text-bg-primary hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
