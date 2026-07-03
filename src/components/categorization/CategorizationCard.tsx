import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Search, X, MessageSquare, ChevronRight, Sparkles, Check } from 'lucide-react';
import type { Category, CategorizationTransaction } from '../../types';
import { formatBRL, formatDate, filterCategoriesByAmount } from '../../lib/utils';
import { CategoryIcon } from '../shared/CategoryIcon';

interface Props {
  transaction: CategorizationTransaction;
  categories: Category[];
  quickCategoryIds: string[];
  onCategorize: (categoryId: string, notes: string) => Promise<void>;
  onSkip: () => void;
  remaining: number;
}

function removeAccents(str: string) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function haptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12);
}

// C2: rede móvel real pendura — sem um teto de tempo o card ficaria invisível
// e os botões desabilitados para sempre. Se o write do Firestore não resolver
// nesse prazo, tratamos como falha e devolvemos o controle (o SDK segue
// tentando em background; o retry é idempotente).
const SAVE_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('save-timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export function CategorizationCard({ transaction, categories, quickCategoryIds, onCategorize, onSkip, remaining }: Props) {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastCategoryId, setLastCategoryId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  // P4: dimensões da área REALMENTE visível (VisualViewport) enquanto o
  // bottom-sheet está aberto — usado para ancorar o sheet acima do teclado.
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);

  const isIncome = transaction.amount >= 0;

  // Categorias válidas para o sinal do valor (receita vs despesa)
  const eligible = useMemo(
    () => filterCategoriesByAmount(categories, transaction.amount),
    [categories, transaction.amount]
  );
  const byId = useMemo(() => new Map(eligible.map((c) => [c.id, c])), [eligible]);
  const parentName = useCallback(
    (c: Category) => (c.parentId ? categories.find((p) => p.id === c.parentId)?.name : undefined),
    [categories]
  );

  // Sugestão pré-calculada (validada para o sinal do valor)
  const suggestion = transaction.suggestedCategoryId ? byId.get(transaction.suggestedCategoryId) : undefined;

  // Grade de acesso rápido: top categorias do histórico, válidas para o sinal,
  // excluindo a sugestão; completa até 6 com as demais em ordem alfabética.
  const quick = useMemo(() => {
    const picked: Category[] = [];
    const seen = new Set<string>();
    if (suggestion) seen.add(suggestion.id);
    for (const id of quickCategoryIds) {
      const c = byId.get(id);
      if (c && !seen.has(c.id)) { picked.push(c); seen.add(c.id); }
      if (picked.length >= 6) break;
    }
    if (picked.length < 6) {
      const rest = [...eligible]
        .filter((c) => !seen.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
      for (const c of rest) {
        picked.push(c); seen.add(c.id);
        if (picked.length >= 6) break;
      }
    }
    return picked;
  }, [quickCategoryIds, byId, eligible, suggestion]);

  // Estado é resetado por remontagem (key={tx.id} no pai), sem efeito.

  const handleSelect = useCallback(async (categoryId: string) => {
    if (saving) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    haptic();
    setSaving(true);
    setSaveError(null);
    setSheetOpen(false);
    setExiting(true);
    await new Promise((r) => setTimeout(r, 220));
    try {
      // C2: sem try/catch, um updateDoc rejeitado (rules) ou pendurado
      // (offline) deixava o card em opacity-0 e os botões desabilitados —
      // tela congelada em silêncio. Agora a falha restaura o card e mostra
      // erro com ação de tentar de novo.
      await withTimeout(onCategorize(categoryId, notes), SAVE_TIMEOUT_MS);
      setExiting(false);
      setSaving(false);
    } catch {
      setExiting(false);
      setSaving(false);
      setLastCategoryId(categoryId);
      setSaveError('Não consegui salvar — verifique a internet e tente de novo.');
    }
  }, [saving, onCategorize, notes]);

  // Busca (bottom-sheet): lista plana, ordem alfabética, filtro por acento-insensível
  const searchResults = useMemo(() => {
    const sorted = [...eligible].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    const term = removeAccents(search.trim().toLowerCase());
    if (!term) return sorted;
    return sorted.filter((c) => {
      const p = parentName(c);
      return removeAccents(c.name.toLowerCase()).includes(term) ||
        (p ? removeAccents(p.toLowerCase()).includes(term) : false);
    });
  }, [eligible, search, parentName]);

  // Fechamento explícito do bottom-sheet: limpa a busca e devolve o foco ao
  // botão que abriu (padrão de diálogo acessível).
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSearch('');
    requestAnimationFrame(() => sheetTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (sheetOpen) {
      const t = setTimeout(() => searchRef.current?.focus(), 240);
      return () => clearTimeout(t);
    }
  }, [sheetOpen]);

  // P4 (iOS Safari real): ao focar a busca, o teclado virtual sobe e cobre a
  // base do layout viewport — a lista de resultados ficava atrás dele. Seguimos
  // o VisualViewport para ancorar o sheet à faixa visível (acima do teclado);
  // a busca fica fixa no topo e os resultados rolam abaixo dela.
  useEffect(() => {
    if (!sheetOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setViewport(null);
    };
  }, [sheetOpen]);

  // A11y do bottom-sheet (WCAG 2.4.3 / 2.1.2): Esc fecha e Tab fica preso
  // dentro do diálogo enquanto ele estiver aberto.
  useEffect(() => {
    if (!sheetOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSheet();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')
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
  }, [sheetOpen, closeSheet]);

  return (
    <div className={`flex flex-col gap-3 transition-all duration-200 ease-out ${exiting ? 'opacity-0 translate-x-10' : 'opacity-100 translate-x-0'}`}>
      {/* Erro de escrita (C2): visível, com retry — nunca congelar em silêncio */}
      {saveError && (
        <div role="alert" className="bg-accent-red/10 border border-accent-red/50 rounded-card p-4 flex flex-col gap-2.5">
          <p className="text-body text-text-primary leading-snug">{saveError}</p>
          {lastCategoryId && (
            <button
              onClick={() => handleSelect(lastCategoryId)}
              disabled={saving}
              className="min-h-[48px] w-full flex items-center justify-center gap-2 bg-bg-card border border-border rounded-full text-body font-semibold text-text-primary active:bg-elevated transition disabled:opacity-50"
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {/* Cartão da transação */}
      <div className="bg-bg-card border border-border rounded-card p-5">
        <p className={`text-caption uppercase tracking-[0.12em] font-semibold ${isIncome ? 'text-accent-green' : 'text-ink-3'}`}>
          {isIncome ? 'Entrada · confirme a categoria' : 'Gasto · escolha a categoria'}
        </p>
        <p className="text-text-primary text-lg font-bold leading-tight mt-1.5 break-words">
          {transaction.description}
        </p>
        <div className="flex items-center gap-2 mt-1 text-body text-text-secondary min-w-0">
          <span className="whitespace-nowrap">{formatDate(transaction.date)}</span>
          {transaction.account && (
            <span className="px-2 py-0.5 bg-elevated rounded-full text-caption tnum truncate">
              {transaction.account}
            </span>
          )}
          {transaction.totalInstallments && (
            <span className="px-2 py-0.5 bg-elevated rounded-full text-caption tnum">
              Parcela {transaction.installmentNumber}/{transaction.totalInstallments}
            </span>
          )}
        </div>
        <p className={`text-kpi font-bold tnum mt-2 ${isIncome ? 'text-accent-green' : 'text-accent-red'}`}>
          {formatBRL(transaction.amount)}
        </p>

        {/* Sugestão mágica — 1 toque */}
        {suggestion ? (
          <>
            <button
              onClick={() => handleSelect(suggestion.id)}
              disabled={saving}
              className="mt-4 w-full flex items-center justify-center gap-2.5 rounded-control px-4 py-4 bg-accent/10 border border-accent-dim text-text-primary text-lg font-bold active:scale-[0.98] transition disabled:opacity-50"
            >
              <CategoryIcon icon={suggestion.icon} size={22} style={{ color: suggestion.color }} />
              <span><span className="text-text-secondary font-medium">É </span>{suggestion.name}<span className="text-text-secondary font-medium">?</span></span>
            </button>
            {transaction.suggestionReason && (
              <p className="mt-2 text-caption text-ink-3 text-center flex items-center justify-center gap-1.5">
                <Sparkles size={12} /> {transaction.suggestionReason} · um toque confirma
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-body text-text-secondary text-center border border-dashed border-border rounded-control py-3 px-3 leading-snug">
            Primeira vez que isso aparece. Escolha abaixo — o app memoriza para as próximas.
          </p>
        )}
      </div>

      {/* Zona do polegar: categorias frequentes */}
      <div className="flex flex-col gap-2">
        <p className="text-caption uppercase tracking-[0.12em] text-ink-3 font-semibold px-1">
          {suggestion ? 'Outras categorias' : 'Categorias frequentes'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {quick.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c.id)}
              disabled={saving}
              className="min-h-[66px] flex flex-col items-center justify-center gap-1.5 bg-bg-card border border-border rounded-control px-1.5 py-3 text-text-primary text-caption font-semibold active:scale-[0.95] active:bg-elevated transition disabled:opacity-50"
            >
              <CategoryIcon icon={c.icon} size={21} style={{ color: c.color }} />
              <span className="text-center leading-tight line-clamp-2">{c.name}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            ref={sheetTriggerRef}
            onClick={() => setSheetOpen(true)}
            disabled={saving}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="flex-1 min-h-[48px] flex items-center justify-center gap-2 bg-bg-card border border-border rounded-full text-body font-semibold text-text-secondary active:bg-elevated transition disabled:opacity-50"
          >
            <Search size={17} /> Buscar categoria
          </button>
          <button
            onClick={onSkip}
            disabled={saving}
            className="flex-1 min-h-[48px] flex items-center justify-center gap-2 bg-bg-card border border-border rounded-full text-body font-semibold text-text-secondary active:bg-elevated transition disabled:opacity-50"
          >
            Pular <ChevronRight size={17} />
          </button>
        </div>

        {/* Observação — opcional, mas com afford claro e alvo ≥48px. Fechada,
            é um campo tocável de largura total (não um texto minúsculo);
            aberta, vira textarea com botão "Pronto". Secundária no peso visual
            (borda tracejada, tom mudo) para não competir com categorizar. */}
        <div className="px-1">
          {!showNotes ? (
            <button
              onClick={() => setShowNotes(true)}
              className="w-full min-h-[48px] flex items-center gap-2.5 px-3.5 rounded-control border border-dashed border-border text-left active:bg-elevated transition-colors"
            >
              <MessageSquare size={16} className="shrink-0 text-ink-3" />
              {notes ? (
                <span className="flex-1 min-w-0 text-body text-text-primary truncate">{notes}</span>
              ) : (
                <span className="flex-1 text-body text-text-secondary">Adicionar observação</span>
              )}
              <span className="shrink-0 text-caption text-ink-3">{notes ? 'Editar' : 'Opcional'}</span>
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: presente de aniversário da mãe…"
                rows={2}
                className="w-full px-3 py-2.5 bg-elevated border border-accent-dim rounded-control text-text-primary text-[16px] placeholder:text-ink-3 focus:border-accent resize-none"
              />
              <button
                onClick={() => setShowNotes(false)}
                className="self-end min-h-[44px] px-4 flex items-center justify-center gap-1.5 rounded-control text-body font-semibold text-text-secondary active:bg-elevated transition-colors"
              >
                <Check size={15} /> Pronto
              </button>
            </div>
          )}
        </div>

        <p className="text-caption text-ink-3 text-center pt-1">
          {remaining} restante{remaining !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Bottom-sheet de busca — diálogo modal de verdade: role/aria-modal,
          Esc fecha, foco preso dentro, botão Fechar visível. */}
      {sheetOpen && (
        <div
          className="fixed left-0 right-0 z-50 bg-black/50 flex items-end"
          style={{ top: viewport ? viewport.top : 0, height: viewport ? viewport.height : '100%' }}
          onClick={closeSheet}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-busca-titulo"
            className="w-full max-h-[92%] bg-bg-secondary border-t border-border rounded-t-[24px] p-4 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between gap-2">
              <h2 id="sheet-busca-titulo" className="text-title font-bold text-text-primary">
                Buscar categoria
              </h2>
              <button
                onClick={closeSheet}
                className="min-h-[44px] min-w-[44px] px-3 -mr-2 flex items-center justify-center gap-1.5 text-body font-semibold text-text-secondary rounded-control active:bg-elevated transition-colors"
              >
                <X size={16} aria-hidden="true" /> Fechar
              </button>
            </div>
            <div className="relative shrink-0">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Digite para filtrar…"
                className="w-full pl-9 pr-12 py-3 bg-elevated border border-border rounded-control text-text-primary text-[16px] placeholder:text-ink-3 focus:border-accent-dim"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                  aria-label="Limpar busca"
                  className="absolute right-0 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-3 hover:text-text-primary"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
              {searchResults.length === 0 ? (
                <p className="text-body text-text-secondary text-center py-6">Nenhuma categoria encontrada</p>
              ) : (
                searchResults.map((c) => {
                  const p = parentName(c);
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleSelect(c.id)}
                      className="flex items-center gap-3.5 py-3 px-1.5 min-h-[50px] border-b border-border text-left active:bg-bg-card transition-colors"
                    >
                      <CategoryIcon icon={c.icon} size={20} style={{ color: c.color }} />
                      <span className="text-text-primary text-[15px] font-medium">{c.name}</span>
                      {p && <span className="ml-auto text-caption text-ink-3">{p}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
