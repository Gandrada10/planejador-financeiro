import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote, Check, Trash2, AlertTriangle } from 'lucide-react';

interface Props {
  note: string;
  /** Nota marcada como alerta (vermelha + aparece no sininho). */
  alert?: boolean;
  onSave: (note: string, alert: boolean) => void;
}

export function NoteTag({ note, alert = false, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftAlert, setDraftAlert] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasNote = note.trim().length > 0;

  useEffect(() => {
    if (open) {
      setDraft(note);
      setDraftAlert(alert);
      // Position the popover relative to the trigger button
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const popoverWidth = 240;
        const left = Math.min(rect.left, window.innerWidth - popoverWidth - 8);
        setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open, note, alert]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function handleSave() {
    const text = draft.trim();
    // Alerta só faz sentido com texto — nota vazia nunca vira alerta.
    onSave(text, text ? draftAlert : false);
    setOpen(false);
  }

  function handleDelete() {
    onSave('', false);
    setOpen(false);
  }

  const popover = open ? createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: 240, zIndex: 9999 }}
      className="bg-[#1a1a1a] border border-border rounded-lg shadow-2xl p-3 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] text-text-secondary uppercase tracking-wider font-bold">Observação</p>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Digite uma observação..."
        rows={3}
        className="w-full bg-bg-secondary border border-border rounded px-2 py-1.5 text-text-primary text-xs focus:outline-none focus:border-accent resize-none placeholder:text-text-secondary/40"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={draftAlert}
          onChange={(e) => setDraftAlert(e.target.checked)}
          style={{ accentColor: 'var(--color-accent-red)' }}
        />
        <span className={`text-[10px] flex items-center gap-1 ${draftAlert ? 'text-accent-red font-bold' : 'text-text-secondary'}`}>
          <AlertTriangle size={11} className={draftAlert ? 'text-accent-red' : 'text-text-secondary'} />
          Marcar como alerta (sininho)
        </span>
      </label>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex items-center justify-center gap-1 flex-1 py-1 bg-accent text-bg-primary text-[10px] font-bold rounded hover:opacity-90"
        >
          <Check size={10} /> Salvar
        </button>
        {hasNote && (
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 px-2 py-1 border border-accent-red/40 text-accent-red text-[10px] rounded hover:bg-accent-red/10"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
      <p className="text-[9px] text-text-secondary/40">Ctrl+Enter para salvar · Esc para fechar</p>
    </div>,
    document.body
  ) : null;

  const isAlert = hasNote && alert;

  return (
    <div className="inline-flex flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {hasNote ? (
        <button
          ref={triggerRef}
          tabIndex={-1}
          onClick={() => setOpen(!open)}
          title={isAlert ? 'Nota de alerta' : 'Nota'}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors leading-none ${
            isAlert
              ? 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30'
              : 'bg-accent/20 text-accent hover:bg-accent/30'
          }`}
        >
          {isAlert ? <AlertTriangle size={9} /> : <StickyNote size={9} />}
          <span>Nota</span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          tabIndex={-1}
          onClick={() => setOpen(!open)}
          title="Adicionar nota"
          className="opacity-0 group-hover:opacity-40 hover:!opacity-100 p-0.5 rounded text-text-secondary transition-opacity"
        >
          <StickyNote size={11} />
        </button>
      )}
      {popover}
    </div>
  );
}
