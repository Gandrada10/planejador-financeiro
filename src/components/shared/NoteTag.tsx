import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote, Check, Trash2 } from 'lucide-react';

interface Props {
  note: string;
  onSave: (note: string) => void;
}

export function NoteTag({ note, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasNote = note.trim().length > 0;

  useEffect(() => {
    if (open) {
      setDraft(note);
      // Position the popover relative to the trigger button
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const popoverWidth = 240;
        const left = Math.min(rect.left, window.innerWidth - popoverWidth - 8);
        setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open, note]);

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
    onSave(draft.trim());
    setOpen(false);
  }

  function handleDelete() {
    onSave('');
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

  return (
    <div className="inline-flex flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {hasNote ? (
        <button
          ref={triggerRef}
          tabIndex={-1}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/20 text-accent hover:bg-accent/30 transition-colors leading-none"
        >
          <StickyNote size={9} />
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
