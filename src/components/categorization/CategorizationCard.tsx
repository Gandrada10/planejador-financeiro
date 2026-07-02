import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Search, X, MessageSquare, ChevronRight, Sparkles } from 'lucide-react';
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

export function CategorizationCard({ transaction, categories, quickCategoryIds, onCategorize, onSkip, remaining }: Props) {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

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

  // Reset ao trocar de transação
  useEffect(() => {
    setNotes('');
    setShowNotes(false);
    setSearch('');
    setSheetOpen(false);
  }, [transaction.id]);

  const handleSelect = useCallback(async (categoryId: string) => {
    if (saving) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    haptic();
    setSaving(true);
    setSheetOpen(false);
    setExiting(true);
    await new Promise((r) => setTimeout(r, 220));
    await onCategorize(categoryId, notes);
    setExiting(false);
    setSaving(false);
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

  useEffect(() => {
    if (sheetOpen) {
      const t = setTimeout(() => searchRef.current?.focus(), 240);
      return () => clearTimeout(t);
    }
  }, [sheetOpen]);

  return (
    <div className={`flex flex-col gap-3 transition-all duration-200 ease-out ${exiting ? 'opacity-0 translate-x-10' : 'opacity-100 translate-x-0'}`}>
      {/* Cartão da transação */}
      <div className="bg-bg-card border border-border rounded-card p-5">
        <p className={`text-caption uppercase tracking-[0.12em] font-semibold ${isIncome ? 'text-accent-green' : 'text-ink-3'}`}>
          {isIncome ? 'Entrada · confirme a categoria' : 'Gasto · escolha a categoria'}
        </p>
        <p className="text-text-primary text-lg font-bold leading-tight mt-1.5 break-words">
          {transaction.description}
        </p>
        <div className="flex items-center gap-2 mt-1 text-body text-text-secondary">
          <span>{formatDate(transaction.date)}</span>
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
            onClick={() => setSheetOpen(true)}
            disabled={saving}
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

        {/* Observação (secundária) */}
        <div className="px-1">
          <button
            onClick={() => setShowNotes((s) => !s)}
            className="flex items-center gap-1.5 text-caption text-ink-3 hover:text-text-secondary transition-colors py-1"
          >
            <MessageSquare size={13} />
            {showNotes ? 'Esconder observação' : 'Adicionar observação'}
          </button>
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: presente de aniversário da mãe…"
              rows={2}
              className="w-full mt-1.5 px-3 py-2 bg-elevated border border-border rounded-control text-text-primary text-[16px] placeholder:text-ink-3 focus:outline-none focus:border-accent-dim resize-none"
            />
          )}
        </div>

        <p className="text-caption text-ink-3 text-center pt-1">
          {remaining} restante{remaining !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Bottom-sheet de busca */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-h-[78%] bg-bg-secondary border-t border-border rounded-t-[24px] p-4 pb-8 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Digite para filtrar…"
                className="w-full pl-9 pr-9 py-3 bg-elevated border border-border rounded-control text-text-primary text-[16px] placeholder:text-ink-3 focus:outline-none focus:border-accent-dim"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-text-primary"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="overflow-y-auto overscroll-contain flex flex-col">
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
