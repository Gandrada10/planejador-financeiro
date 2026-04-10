import { ChevronDown, ChevronUp, Trash2, CheckCircle2, ArrowUp, ArrowDown, ArrowUpDown, MoveRight, Zap } from 'lucide-react';
import { useState, useMemo } from 'react';
import { formatBRL, formatDate, tabNavigate, getMonthLabel } from '../../lib/utils';
import type { Transaction, Category, Project } from '../../types';
import { CategoryCombobox } from '../shared/CategoryCombobox';
import { NoteTag } from '../shared/NoteTag';

interface TitularGroup {
  titular: string;
  total: number;
  transactions: Transaction[];
}

interface Props {
  groups: TitularGroup[];
  categories: Category[];
  projects?: Project[];
  totalTransactions: number;
  availableMonths?: string[];
  currentMonthYear?: string;
  onUpdate?: (id: string, data: Partial<Transaction>) => void;
  onDelete?: (id: string) => void;
  onBatchReconcile?: (ids: string[], reconciled: boolean) => void;
  onBatchMove?: (ids: string[], targetMonthYear: string) => Promise<void>;
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
  onCreateRule?: (description: string, categoryId: string) => void;
}

export function InvoiceTransactionList({ groups, categories, projects = [], totalTransactions, availableMonths = [], currentMonthYear, onUpdate, onDelete, onBatchReconcile, onBatchMove, checkClosedCycle, reopenCycle, onCreateRule }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'purchaseDate' | 'date'>('purchaseDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterPending, setFilterPending] = useState(false);
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [moveTargetMonth, setMoveTargetMonth] = useState('');
  const [movingIds, setMovingIds] = useState(false);

  function toggleSort(field: 'purchaseDate' | 'date') {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }: { field: 'purchaseDate' | 'date' }) {
    if (sortField !== field) return <ArrowUpDown size={9} className="inline ml-0.5 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp size={9} className="inline ml-0.5 text-accent" />
      : <ArrowDown size={9} className="inline ml-0.5 text-accent" />;
  }

  const allTransactions = useMemo(() => groups.flatMap((g) => g.transactions), [groups]);

  // Filtered groups when pending filter is active
  const displayGroups = useMemo(() => {
    if (!filterPending) return groups;
    return groups
      .map((g) => ({ ...g, transactions: g.transactions.filter((t) => !t.reconciled) }))
      .filter((g) => g.transactions.length > 0);
  }, [groups, filterPending]);

  // Pending count based on what's currently visible (before the pending toggle itself)
  const pendingCount = useMemo(
    () => allTransactions.filter((t) => !t.reconciled).length,
    [allTransactions]
  );

  function toggleGroup(titular: string) {
    const next = new Set(collapsed);
    if (next.has(titular)) next.delete(titular); else next.add(titular);
    setCollapsed(next);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function getCategoryLabel(catId: string | null): string {
    if (!catId) return '';
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return '';
    const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : null;
    return parent ? `${parent.name}/${cat.name}` : cat.name;
  }

  async function guardClosedCycle(t: Transaction): Promise<boolean> {
    if (!checkClosedCycle || !reopenCycle) return true;
    const closed = checkClosedCycle(t);
    if (!closed) return true;
    const ok = window.confirm(
      `A fatura "${closed.label}" esta encerrada.\n\nDeseja reabri-la para editar esta transacao?`
    );
    if (!ok) return false;
    await reopenCycle(closed.cycleId);
    return true;
  }

  function startEdit(id: string, field: string, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  }

  async function commitEdit(t: Transaction) {
    if (!editingCell || !onUpdate) return;
    const { field } = editingCell;

    const ok = await guardClosedCycle(t);
    if (!ok) { setEditingCell(null); return; }

    if (field === 'description' && editValue.trim()) {
      onUpdate(t.id, { description: editValue.trim() });
    } else if (field === 'amount') {
      const val = parseFloat(editValue.replace(',', '.'));
      if (!isNaN(val)) onUpdate(t.id, { amount: val });
    } else if (field === 'date' && editValue) {
      const d = new Date(editValue + 'T12:00:00');
      if (!isNaN(d.getTime())) onUpdate(t.id, { date: d });
    } else if (field === 'purchaseDate') {
      if (!editValue) {
        onUpdate(t.id, { purchaseDate: null });
      } else {
        const d = new Date(editValue + 'T12:00:00');
        if (!isNaN(d.getTime())) onUpdate(t.id, { purchaseDate: d });
      }
    } else if (field === 'installments') {
      const parts = editValue.split('/');
      const num = parseInt(parts[0]);
      const total = parseInt(parts[1]);
      if (!isNaN(num) && !isNaN(total)) {
        onUpdate(t.id, { installmentNumber: num, totalInstallments: total });
      } else if (!editValue.trim()) {
        onUpdate(t.id, { installmentNumber: null, totalInstallments: null });
      }
    }

    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, t: Transaction) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const cell = (e.target as HTMLElement).closest('[data-tab-cell]');
      commitEdit(t);
      if (e.key === 'Tab' && cell) {
        setTimeout(() => tabNavigate(cell as HTMLElement, e.shiftKey ? 'prev' : 'next'), 50);
      }
    }
    if (e.key === 'Escape') setEditingCell(null);
  }

  const editable = onUpdate ? 'cursor-pointer hover:bg-bg-secondary/50 transition-colors' : '';

  return (
    <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-text-primary">{totalTransactions} lancamentos</span>
          {pendingCount > 0 && (
            <button
              onClick={() => setFilterPending(!filterPending)}
              className={`text-[10px] hover:underline ${filterPending ? 'text-accent font-bold' : 'text-accent'}`}
            >
              {pendingCount} pendentes conciliacao{filterPending && ' ✕'}
            </button>
          )}
          <span className="text-[10px] text-text-secondary">
            Ordenar:
            <button onClick={() => toggleSort('purchaseDate')} className="ml-1 hover:text-text-primary">
              Data <SortIcon field="purchaseDate" />
            </button>
            <span className="mx-1">·</span>
            <button onClick={() => toggleSort('date')} className="hover:text-text-primary">
              Competencia <SortIcon field="date" />
            </button>
          </span>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {onBatchReconcile && (() => {
              const selList = allTransactions.filter((t) => selectedIds.has(t.id));
              const allRec = selList.every((t) => t.reconciled);
              return allRec ? (
                <button
                  onClick={() => { onBatchReconcile([...selectedIds], false); setSelectedIds(new Set()); }}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:underline"
                >
                  <CheckCircle2 size={12} /> Desconciliar ({selectedIds.size})
                </button>
              ) : (
                <button
                  onClick={() => { onBatchReconcile([...selectedIds], true); setSelectedIds(new Set()); }}
                  className="flex items-center gap-1 text-xs text-accent-green hover:underline"
                >
                  <CheckCircle2 size={12} /> Conciliar ({selectedIds.size})
                </button>
              );
            })()}
            {onBatchMove && (
              <button
                onClick={() => { setShowMovePanel((v) => !v); setMoveTargetMonth(''); }}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <MoveRight size={12} /> Mover para fatura ({selectedIds.size})
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => { selectedIds.forEach((id) => onDelete(id)); setSelectedIds(new Set()); }}
                className="flex items-center gap-1 text-xs text-accent-red hover:underline"
              >
                <Trash2 size={12} /> Excluir ({selectedIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Move to another invoice panel */}
      {showMovePanel && onBatchMove && (
        <div className="px-4 py-3 border-b border-border bg-accent/5 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-secondary">Mover {selectedIds.size} lançamento(s) para a fatura de:</span>
          <select
            value={moveTargetMonth}
            onChange={(e) => setMoveTargetMonth(e.target.value)}
            className="px-2 py-1 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          >
            <option value="">Selecionar mês...</option>
            {availableMonths
              .filter((m) => m !== currentMonthYear)
              .map((m) => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
          </select>
          <button
            disabled={!moveTargetMonth || movingIds}
            onClick={async () => {
              if (!moveTargetMonth) return;
              setMovingIds(true);
              await onBatchMove([...selectedIds], moveTargetMonth);
              setSelectedIds(new Set());
              setShowMovePanel(false);
              setMoveTargetMonth('');
              setMovingIds(false);
            }}
            className="px-3 py-1 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40"
          >
            {movingIds ? 'Movendo...' : 'Confirmar'}
          </button>
          <button
            onClick={() => { setShowMovePanel(false); setMoveTargetMonth(''); }}
            className="text-xs text-text-secondary hover:text-text-primary"
          >
            Cancelar
          </button>
        </div>
      )}

      {displayGroups.length === 0 ? (
        <div className="p-8 text-center text-text-secondary text-xs">
          Nenhuma transacao neste periodo
        </div>
      ) : (
        <div className="divide-y divide-border">
          {displayGroups.map((group) => {
            const isCollapsed = collapsed.has(group.titular);
            return (
              <div key={group.titular}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.titular)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-secondary hover:bg-bg-secondary/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronUp size={14} className="text-text-secondary" />}
                    <span className="text-xs font-bold text-text-primary">
                      {group.titular || 'Sem titular'}
                    </span>
                    {(() => {
                      const cardNum = group.transactions[0]?.cardNumber;
                      const last4 = cardNum ? cardNum.replace(/\D/g, '').slice(-4) : null;
                      return last4 ? (
                        <span className="text-[10px] text-text-secondary font-mono">**** {last4}</span>
                      ) : null;
                    })()}
                  </div>
                  <span className="text-xs font-bold text-accent-red">{formatBRL(group.total)}</span>
                </button>

                {/* Transactions */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/30">
                    {/* Column headers */}
                    <div className="flex items-center px-4 py-1.5 text-text-secondary uppercase tracking-wider text-[10px]">
                      <div className="w-6 flex-shrink-0" />
                      <div className="w-[70px] flex-shrink-0">Data</div>
                      <div className="flex-1 min-w-0 px-2">Descricao</div>
                      <div className="flex-shrink-0 w-[55px] text-center">Parcelas</div>
                      <div className="flex-shrink-0 w-[130px] mr-2">Categoria</div>
                      <div className="flex-shrink-0 w-[80px] mr-1">Projeto</div>
                      <div className="flex-shrink-0 w-[85px] text-right">Valor</div>
                    </div>
                    {[...group.transactions].sort((a, b) => {
                      const av = sortField === 'date' ? a.date : (a.purchaseDate || a.date);
                      const bv = sortField === 'date' ? b.date : (b.purchaseDate || b.date);
                      const diff = av.getTime() - bv.getTime();
                      return sortDir === 'asc' ? diff : -diff;
                    }).map((t) => (
                      <div key={t.id} className="flex items-center px-4 py-2 hover:bg-bg-secondary/30 transition-colors group">
                        {/* Conciliação dot - tab-navigable */}
                        <div className="w-6 flex-shrink-0 flex justify-center" data-tab-cell>
                          <div
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={selectedIds.has(t.id)}
                            className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-colors outline-none focus:ring-2 focus:ring-accent/50 ${
                              selectedIds.has(t.id)
                                ? 'bg-accent border-accent'
                                : t.reconciled
                                ? 'bg-accent-green border-accent-green'
                                : 'border-border hover:border-accent hover:bg-accent/20'
                            }`}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSelect(t.id);
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                const cell = (e.target as HTMLElement).closest('[data-tab-cell]');
                                if (cell) tabNavigate(cell as HTMLElement, e.shiftKey ? 'prev' : 'next');
                              }
                            }}
                            title={t.reconciled ? 'Conciliado – Enter para selecionar' : 'Enter para selecionar'}
                          />
                        </div>

                        {/* Purchase date - editable */}
                        <div
                          data-tab-cell
                          className={`text-xs text-text-secondary w-[70px] flex-shrink-0 overflow-hidden truncate ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'purchaseDate', (t.purchaseDate || t.date).toISOString().split('T')[0])}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'purchaseDate' ? (
                            <input
                              autoFocus
                              type="date"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : formatDate(t.purchaseDate || t.date)}
                        </div>

                        {/* Description - editable */}
                        <div
                          data-tab-cell
                          className={`flex-1 min-w-0 px-2 overflow-hidden ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'description', t.description)}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'description' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                            />
                          ) : (
                            <>
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-xs text-text-primary truncate">{t.description}</span>
                                <NoteTag
                                  note={t.notes || ''}
                                  onSave={(note) => onUpdate && onUpdate(t.id, { notes: note })}
                                />
                              </div>
                              {t.categoryId && (
                                <p className="text-xs text-text-secondary truncate">
                                  {getCategoryLabel(t.categoryId)}
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Parcelas - editable, separate column */}
                        <div
                          data-tab-cell
                          className={`flex-shrink-0 w-[55px] text-center overflow-hidden ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'installments', t.totalInstallments ? `${t.installmentNumber ?? 1}/${t.totalInstallments}` : '')}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'installments' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              placeholder="1/12"
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-[10px] text-center focus:outline-none"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : t.totalInstallments ? (
                            <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded font-mono">
                              {t.installmentNumber}/{t.totalInstallments}
                            </span>
                          ) : (
                            <span className="text-[10px] text-text-secondary">—</span>
                          )}
                        </div>

                        {/* Category - combobox with autocomplete + tab navigation */}
                        {onUpdate ? (
                          <div className="flex-shrink-0 w-[130px] mr-2 flex items-center gap-1">
                            <CategoryCombobox
                              categories={categories}
                              amount={t.amount}
                              value={t.categoryId}
                              onChange={async (val) => {
                                const ok = await guardClosedCycle(t);
                                if (!ok) return;
                                onUpdate(t.id, { categoryId: val });
                              }}
                              compact
                            />
                            {t.categoryId && onCreateRule && (
                              <button
                                title="Criar regra para esta descrição"
                                onClick={() => onCreateRule(t.description, t.categoryId!)}
                                className="text-text-secondary hover:text-accent flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Zap size={11} />
                              </button>
                            )}
                          </div>
                        ) : null}

                        {/* Projeto */}
                        {onUpdate ? (
                          <div className="flex-shrink-0 w-[80px] mr-1 overflow-hidden">
                            <select
                              tabIndex={-1}
                              value={t.projectId || ''}
                              onChange={async (e) => {
                                const value = e.target.value;
                                const ok = await guardClosedCycle(t);
                                if (!ok) return;
                                onUpdate(t.id, { projectId: value || null });
                              }}
                              className="w-full bg-transparent border-none text-[10px] cursor-pointer focus:outline-none hover:text-text-primary truncate"
                              style={{ color: projects.find((p) => p.id === t.projectId)?.color || 'var(--color-text-secondary)' }}
                            >
                              <option value="" style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>—</option>
                              {projects.filter((p) => p.status === 'active').map((p) => (
                                <option key={p.id} value={p.id} style={{ backgroundColor: '#111111', color: p.color }}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {/* Amount - editable */}
                        <div
                          data-tab-cell
                          className={`text-xs font-bold flex-shrink-0 w-[85px] text-right overflow-hidden ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'} ${editable}`}
                          onClick={() => onUpdate && startEdit(t.id, 'amount', String(t.amount))}
                        >
                          {editingCell?.id === t.id && editingCell.field === 'amount' ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(t)}
                              onKeyDown={(e) => handleKeyDown(e, t)}
                              className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-right focus:outline-none"
                            />
                          ) : (
                            formatBRL(t.amount)
                          )}
                        </div>

                        {/* Delete */}
                        {onDelete && (
                          <button
                            tabIndex={-1}
                            onClick={async () => {
                              const ok = await guardClosedCycle(t);
                              if (!ok) return;
                              onDelete(t.id);
                            }}
                            className="ml-2 text-text-secondary hover:text-accent-red flex-shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
