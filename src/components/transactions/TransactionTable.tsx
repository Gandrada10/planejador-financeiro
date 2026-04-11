import { useState, useMemo } from 'react';
import { Trash2, CheckCircle2, ArrowUp, ArrowDown, ArrowUpDown, Zap } from 'lucide-react';
import type { Transaction, Category, Project, CategoryRule } from '../../types';
import { formatBRL, formatDate, tabNavigate, applyMoneyMask, parseMoneyInput } from '../../lib/utils';
import { CategoryCombobox } from '../shared/CategoryCombobox';
import { NoteTag } from '../shared/NoteTag';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  projects?: Project[];
  accountNames: string[];
  onUpdate: (id: string, data: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
  onBatchReconcile?: (ids: string[], reconciled: boolean) => void;
  checkClosedCycle?: (transaction: Transaction) => { cycleId: string; label: string } | null;
  reopenCycle?: (cycleId: string) => Promise<void>;
  onCreateRule?: (description: string, categoryId: string) => void;
  rules?: CategoryRule[];
}

export function TransactionTable({ transactions, categories, projects = [], accountNames, onUpdate, onDelete, onBatchReconcile, checkClosedCycle, reopenCycle, onCreateRule, rules = [] }: Props) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'date' | 'purchaseDate'>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  function toggleSort(field: 'date' | 'purchaseDate') {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const av = sortField === 'date' ? a.date : (a.purchaseDate || a.date);
      const bv = sortField === 'date' ? b.date : (b.purchaseDate || b.date);
      const diff = av.getTime() - bv.getTime();
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [transactions, sortField, sortDir]);

  function SortIcon({ field }: { field: 'date' | 'purchaseDate' }) {
    if (sortField !== field) return <ArrowUpDown size={10} className="inline ml-1 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="inline ml-1 text-accent" />
      : <ArrowDown size={10} className="inline ml-1 text-accent" />;
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

  // Persiste o valor editado no Firestore em background (não bloqueia a UI)
  async function persistEdit(id: string, field: string, value: string) {
    const t = sorted.find((tx) => tx.id === id);
    if (!t) return;

    const canProceed = await guardClosedCycle(t);
    if (!canProceed) return;

    if (field === 'description' && value.trim()) {
      onUpdate(id, { description: value.trim() });
    } else if (field === 'amount') {
      const val = parseMoneyInput(value);
      if (val !== 0) onUpdate(id, { amount: val });
    } else if (field === 'familyMember') {
      onUpdate(id, { familyMember: value.trim() });
    } else if (field === 'titular') {
      onUpdate(id, { titular: value.trim() });
    } else if (field === 'date' && value) {
      const d = new Date(value + 'T12:00:00');
      if (!isNaN(d.getTime())) onUpdate(id, { date: d });
    } else if (field === 'purchaseDate') {
      if (!value) {
        onUpdate(id, { purchaseDate: null });
      } else {
        const d = new Date(value + 'T12:00:00');
        if (!isNaN(d.getTime())) onUpdate(id, { purchaseDate: d });
      }
    } else if (field === 'installments') {
      const parts = value.split('/');
      const num = parseInt(parts[0]);
      const total = parseInt(parts[1]);
      if (!isNaN(num) && !isNaN(total)) {
        onUpdate(id, { installmentNumber: num, totalInstallments: total });
      } else if (!value.trim()) {
        onUpdate(id, { installmentNumber: null, totalInstallments: null });
      }
    }
  }

  // Limpa o estado de edição imediatamente (síncrono) e salva no Firestore em background
  function commitEdit() {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const value = editValue;
    setEditingCell(null); // Limpa UI imediatamente — sem await
    persistEdit(id, field, value); // Salva em background
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setEditingCell(null); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const cell = (e.target as HTMLElement).closest('[data-tab-cell]');
      const direction = e.key === 'Tab' ? (e.shiftKey ? 'prev' : 'next') : null;
      commitEdit(); // Síncrono: limpa estado imediatamente
      // Navega após React re-renderizar (requestAnimationFrame = próximo frame)
      if (direction && cell) {
        requestAnimationFrame(() => tabNavigate(cell as HTMLElement, direction));
      }
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll() {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((t) => t.id)));
    }
  }

  function deleteSelected() {
    selectedIds.forEach((id) => onDelete(id));
    setSelectedIds(new Set());
  }

  function reconcileSelected(reconcile: boolean) {
    if (!onBatchReconcile) return;
    onBatchReconcile([...selectedIds], reconcile);
    setSelectedIds(new Set());
  }

  if (sorted.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
        Nenhuma transacao ainda. Importe um extrato ou adicione manualmente.
      </div>
    );
  }

  const editableCell = 'cursor-pointer hover:bg-bg-secondary/50 transition-colors';
  const allSelected = selectedIds.size === sorted.length && sorted.length > 0;

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-bg-secondary rounded text-xs">
          <span className="text-text-secondary">{selectedIds.size} selecionadas</span>
          {onBatchReconcile && (() => {
            const selectedList = sorted.filter((t) => selectedIds.has(t.id));
            const allReconciled = selectedList.every((t) => t.reconciled);
            return allReconciled ? (
              <button onClick={() => reconcileSelected(false)} className="text-text-secondary hover:underline flex items-center gap-1">
                <CheckCircle2 size={12} /> Desconciliar
              </button>
            ) : (
              <button onClick={() => reconcileSelected(true)} className="text-accent-green hover:underline flex items-center gap-1">
                <CheckCircle2 size={12} /> Conciliar
              </button>
            );
          })()}
          <button onClick={deleteSelected} className="text-accent-red hover:underline flex items-center gap-1">
            <Trash2 size={12} /> Excluir
          </button>
        </div>
      )}

      <div className="overflow-auto bg-bg-card border border-border rounded-lg max-w-[963px]">
        <table className="w-full min-w-[963px] text-xs table-fixed">
          <colgroup>
            <col style={{ width: 32 }} />  {/* dot */}
            <col style={{ width: 82 }} />  {/* competencia */}
            <col style={{ width: 82 }} />  {/* data */}
            <col style={{ width: 210 }} /> {/* descricao - fixa para nao crescer */}
            <col style={{ width: 115 }} /> {/* categoria */}
            <col style={{ width: 88 }} />  {/* valor */}
            <col style={{ width: 58 }} />  {/* parcelas */}
            <col style={{ width: 82 }} />  {/* conta */}
            <col style={{ width: 72 }} />  {/* membro */}
            <col style={{ width: 110 }} /> {/* projeto */}
            <col style={{ width: 32 }} />  {/* delete */}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-text-secondary uppercase tracking-wider text-[10px]">
              <th className="p-2 text-center">
                <div
                  className={`w-3 h-3 rounded-full border mx-auto cursor-pointer transition-colors ${
                    allSelected ? 'bg-accent border-accent' : 'border-border hover:border-accent'
                  }`}
                  onClick={toggleAll}
                  title={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                />
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:text-text-primary" onClick={() => toggleSort('date')}>
                Competencia <SortIcon field="date" />
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:text-text-primary" onClick={() => toggleSort('purchaseDate')}>
                Data <SortIcon field="purchaseDate" />
              </th>
              <th className="p-2 text-left">Descricao</th>
              <th className="p-2 text-left">Categoria</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2 text-center">Parcelas</th>
              <th className="p-2 text-left">Conta</th>
              <th className="p-2 text-left">Membro</th>
              <th className="p-2 text-left">Projeto</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="border-b border-border/30 hover:bg-bg-secondary/30 group">
                {/* Conciliação dot - tab-navigable */}
                <td className="p-2" data-tab-cell>
                  <div
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={selectedIds.has(t.id)}
                    className={`w-3.5 h-3.5 rounded-full border mx-auto cursor-pointer transition-colors outline-none focus:ring-2 focus:ring-accent/50 ${
                      selectedIds.has(t.id)
                        ? 'bg-accent border-accent'
                        : t.reconciled
                        ? 'bg-accent-green border-accent-green'
                        : 'border-border hover:border-accent hover:bg-accent/20'
                    }`}
                    onClick={() => toggleSelect(t.id)}
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
                </td>

                {/* Competencia - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-text-secondary truncate overflow-hidden ${editableCell}`}
                  onClick={() => startEdit(t.id, 'date', t.date.toISOString().split('T')[0])}
                >
                  {editingCell?.id === t.id && editingCell.field === 'date' ? (
                    <input
                      autoFocus
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : formatDate(t.date)}
                </td>

                {/* Data compra - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-text-secondary truncate overflow-hidden ${editableCell}`}
                  onClick={() => startEdit(t.id, 'purchaseDate', t.purchaseDate ? t.purchaseDate.toISOString().split('T')[0] : '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'purchaseDate' ? (
                    <input
                      autoFocus
                      type="date"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : t.purchaseDate ? formatDate(t.purchaseDate) : '—'}
                </td>

                {/* Descricao - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-text-primary overflow-hidden ${editableCell}`}
                  onClick={() => startEdit(t.id, 'description', t.description)}
                >
                  {editingCell?.id === t.id && editingCell.field === 'description' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="truncate">{t.description}</span>
                      <NoteTag
                        note={t.notes || ''}
                        onSave={(note) => onUpdate(t.id, { notes: note })}
                      />
                    </div>
                  )}
                </td>

                {/* Categoria - combobox with autocomplete + tab navigation */}
                <td className="p-2 relative">
                  <div className="flex items-center gap-1 min-w-0">
                    <CategoryCombobox
                      className="min-w-0 flex-1"
                      categories={categories}
                      amount={t.amount}
                      value={t.categoryId}
                      onChange={async (val) => {
                        const ok = await guardClosedCycle(t);
                        if (!ok) return;
                        onUpdate(t.id, { categoryId: val });
                      }}
                    />
                    {t.categoryId && onCreateRule && (() => {
                      const hasRule = rules.some((r) => r.pattern.toLowerCase() === t.description.toLowerCase());
                      return (
                        <button
                          title={hasRule ? 'Atualizar regra existente' : 'Criar regra para esta descrição'}
                          onClick={() => onCreateRule(t.description, t.categoryId!)}
                          className={`flex-shrink-0 transition-colors ${
                            hasRule
                              ? 'text-yellow-400 hover:text-yellow-300'
                              : 'text-text-secondary/30 hover:text-text-secondary'
                          }`}
                        >
                          <Zap size={12} />
                        </button>
                      );
                    })()}
                  </div>
                </td>

                {/* Valor - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-right font-bold truncate overflow-hidden ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'} ${editableCell}`}
                  onClick={() => startEdit(t.id, 'amount', t.amount < 0
                    ? '-' + applyMoneyMask(String(Math.round(Math.abs(t.amount) * 100)))
                    : applyMoneyMask(String(Math.round(Math.abs(t.amount) * 100)))
                  )}
                >
                  {editingCell?.id === t.id && editingCell.field === 'amount' ? (
                    <input
                      autoFocus
                      inputMode="numeric"
                      value={editValue}
                      onChange={(e) => setEditValue(applyMoneyMask(e.target.value))}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-right focus:outline-none"
                    />
                  ) : (
                    formatBRL(t.amount)
                  )}
                </td>

                {/* Parcelas - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-center text-text-secondary overflow-hidden ${editableCell}`}
                  onClick={() => startEdit(t.id, 'installments', t.totalInstallments ? `${t.installmentNumber ?? 1}/${t.totalInstallments}` : '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'installments' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      placeholder="1/12"
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs text-center focus:outline-none"
                    />
                  ) : t.totalInstallments ? (
                    <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px] font-mono">
                      {t.installmentNumber ?? '?'}/{t.totalInstallments}
                    </span>
                  ) : '—'}
                </td>

                {/* Conta - select */}
                <td className="p-2 text-text-secondary overflow-hidden">
                  <select
                    tabIndex={-1}
                    value={t.account}
                    onChange={async (e) => {
                      const val = e.target.value;
                      const ok = await guardClosedCycle(t);
                      if (!ok) { e.target.value = t.account; return; }
                      onUpdate(t.id, { account: val });
                    }}
                    className="w-full bg-transparent border-none text-xs text-text-secondary cursor-pointer focus:outline-none hover:text-text-primary"
                  >
                    <option value="">—</option>
                    {accountNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>

                {/* Membro - editable */}
                <td
                  data-tab-cell
                  className={`p-2 text-text-secondary truncate overflow-hidden ${editableCell}`}
                  onClick={() => startEdit(t.id, 'familyMember', t.familyMember || '')}
                >
                  {editingCell?.id === t.id && editingCell.field === 'familyMember' ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-bg-secondary border border-accent rounded px-1 py-0.5 text-text-primary text-xs focus:outline-none"
                    />
                  ) : (
                    t.familyMember || '—'
                  )}
                </td>

                {/* Projeto */}
                <td className="p-2 overflow-hidden">
                  <select
                    tabIndex={-1}
                    value={t.projectId || ''}
                    onChange={async (e) => {
                      const value = e.target.value;
                      const ok = await guardClosedCycle(t);
                      if (!ok) return;
                      onUpdate(t.id, { projectId: value || null });
                    }}
                    className="w-full bg-transparent border-none text-xs cursor-pointer focus:outline-none hover:text-text-primary truncate"
                    style={{ color: projects.find((p) => p.id === t.projectId)?.color || 'var(--color-text-secondary)' }}
                  >
                    <option value="" style={{ backgroundColor: '#111111', color: '#e5e5e5' }}>—</option>
                    {projects.filter((p) => p.status === 'active').map((p) => (
                      <option key={p.id} value={p.id} style={{ backgroundColor: '#111111', color: p.color }}>{p.name}</option>
                    ))}
                  </select>
                </td>

                <td className="p-2">
                  <button tabIndex={-1} onClick={async () => {
                    const ok = await guardClosedCycle(t);
                    if (!ok) return;
                    onDelete(t.id);
                  }} className="text-text-secondary hover:text-accent-red">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
