import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Copy, Trash2, Check, X } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { MonthSelector } from '../shared/MonthSelector';
import { CategoryIcon } from '../shared/CategoryIcon';
import {
  formatBRL,
  getMonthYear,
  getMonthYearOffset,
  applyMoneyMask,
  parseMoneyInput,
} from '../../lib/utils';

interface BudgetRow {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  icon: string;
  color: string;
  isParent: boolean;
  meta: number;
  realizado: number;
  aRealizar: number;
  excedente: number;
  percentage: number;
}

interface BudgetGroup {
  parentId: string;
  parentName: string;
  parentIcon: string;
  parentColor: string;
  parentRow: BudgetRow | null;
  subRows: BudgetRow[];
  totalMeta: number;
  totalRealizado: number;
  totalARealizar: number;
  totalExcedente: number;
  totalPercentage: number;
}

export function ExpenseGoalsTab() {
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const { transactions } = useTransactions();
  const { categories, rootCategories, subCategories } = useCategories();
  const { budgets, addBudget, updateBudget, deleteBudget, getBudgetsForMonth } = useBudgets();

  // Editing state
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addCategoryId, setAddCategoryId] = useState('');
  const [addAmount, setAddAmount] = useState('');

  // Focus edit input when editing
  useEffect(() => {
    if (editingBudgetId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingBudgetId]);

  // Budgets for current month
  const monthBudgets = useMemo(
    () => getBudgetsForMonth(monthYear),
    [getBudgetsForMonth, monthYear]
  );

  // Available months
  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    for (const b of budgets) set.add(b.monthYear);
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions, budgets]);

  // Month transactions (expenses only, absolute values)
  const monthExpenses = useMemo(
    () => transactions.filter((t) => getMonthYear(t.date) === monthYear && t.amount < 0),
    [transactions, monthYear]
  );

  // Actual spending per category (as positive number)
  const actualByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of monthExpenses) {
      const catId = t.categoryId || '__uncategorized';
      map.set(catId, (map.get(catId) || 0) + Math.abs(t.amount));
    }
    return map;
  }, [monthExpenses]);

  // Total actual spending for a parent category (including all subs)
  function getActualForParent(parentId: string): number {
    let total = actualByCategory.get(parentId) || 0;
    for (const sub of subCategories(parentId)) {
      total += actualByCategory.get(sub.id) || 0;
    }
    return total;
  }

  // Build grouped budget rows
  const budgetGroups = useMemo(() => {
    const groups: BudgetGroup[] = [];
    const processedParentIds = new Set<string>();

    for (const budget of monthBudgets) {
      const cat = categories.find((c) => c.id === budget.categoryId);
      if (!cat) continue;

      const parentId = cat.parentId || cat.id;
      if (processedParentIds.has(parentId)) continue;
      processedParentIds.add(parentId);

      const parentCat = cat.parentId
        ? categories.find((c) => c.id === cat.parentId)
        : cat;

      const subs = subCategories(parentId);

      // Parent-level budget
      const parentBudgetEntry = monthBudgets.find((b) => b.categoryId === parentId);
      const parentRealizado = getActualForParent(parentId);
      const parentMeta = parentBudgetEntry?.limitAmount || 0;

      const parentRow: BudgetRow | null = parentBudgetEntry
        ? {
            budgetId: parentBudgetEntry.id,
            categoryId: parentId,
            categoryName: parentCat?.name || 'Categoria',
            icon: parentCat?.icon || '',
            color: parentCat?.color || '#737373',
            isParent: true,
            meta: parentMeta,
            realizado: parentRealizado,
            aRealizar: Math.max(parentMeta - parentRealizado, 0),
            excedente: Math.max(parentRealizado - parentMeta, 0),
            percentage: parentMeta > 0 ? (parentRealizado / parentMeta) * 100 : 0,
          }
        : null;

      // Sub-level budgets
      const subRows: BudgetRow[] = monthBudgets
        .filter((b) => subs.some((s) => s.id === b.categoryId))
        .map((b) => {
          const subCat = categories.find((c) => c.id === b.categoryId);
          const actual = actualByCategory.get(b.categoryId) || 0;
          return {
            budgetId: b.id,
            categoryId: b.categoryId,
            categoryName: subCat?.name || 'Subcategoria',
            icon: subCat?.icon || '',
            color: subCat?.color || '#737373',
            isParent: false,
            meta: b.limitAmount,
            realizado: actual,
            aRealizar: Math.max(b.limitAmount - actual, 0),
            excedente: Math.max(actual - b.limitAmount, 0),
            percentage: b.limitAmount > 0 ? (actual / b.limitAmount) * 100 : 0,
          };
        });

      // Use parent meta for totals; if no parent budget, sum sub budgets
      const totalMeta = parentRow ? parentRow.meta : subRows.reduce((s, r) => s + r.meta, 0);
      const totalRealizado = parentRow ? parentRealizado : subRows.reduce((s, r) => s + r.realizado, 0);

      groups.push({
        parentId,
        parentName: parentCat?.name || 'Categoria',
        parentIcon: parentCat?.icon || '',
        parentColor: parentCat?.color || '#737373',
        parentRow,
        subRows,
        totalMeta,
        totalRealizado,
        totalARealizar: Math.max(totalMeta - totalRealizado, 0),
        totalExcedente: Math.max(totalRealizado - totalMeta, 0),
        totalPercentage: totalMeta > 0 ? (totalRealizado / totalMeta) * 100 : 0,
      });
    }

    return groups.sort((a, b) => a.parentName.localeCompare(b.parentName));
  }, [monthBudgets, categories, subCategories, actualByCategory]);

  // Grand totals (sum of parent-level or group-level)
  const grandTotalMeta = budgetGroups.reduce((s, g) => s + g.totalMeta, 0);
  const grandTotalRealizado = budgetGroups.reduce((s, g) => s + g.totalRealizado, 0);
  const grandTotalARealizar = Math.max(grandTotalMeta - grandTotalRealizado, 0);
  const grandTotalExcedente = Math.max(grandTotalRealizado - grandTotalMeta, 0);
  const grandTotalPct = grandTotalMeta > 0 ? (grandTotalRealizado / grandTotalMeta) * 100 : 0;

  // Available expense categories for adding new budgets
  const availableCategories = useMemo(() => {
    const usedIds = new Set(monthBudgets.map((b) => b.categoryId));
    return categories
      .filter(
        (c) =>
          (c.type === 'despesa' || c.type === 'ambos') && !usedIds.has(c.id)
      )
      .sort((a, b) => {
        // Show parents first, then subs indented
        const aParent = a.parentId
          ? categories.find((c) => c.id === a.parentId)?.name || ''
          : a.name;
        const bParent = b.parentId
          ? categories.find((c) => c.id === b.parentId)?.name || ''
          : b.name;
        if (aParent !== bParent) return aParent.localeCompare(bParent);
        if (!a.parentId && b.parentId) return -1;
        if (a.parentId && !b.parentId) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [categories, monthBudgets]);

  // Previous month that has budgets
  const prevMonthWithBudgets = useMemo(() => {
    const prevMonth = getMonthYearOffset(monthYear, -1);
    const prevBudgets = getBudgetsForMonth(prevMonth);
    return prevBudgets.length > 0 ? prevMonth : null;
  }, [monthYear, getBudgetsForMonth]);

  // Handlers
  function startEdit(budgetId: string, currentAmount: number) {
    setEditingBudgetId(budgetId);
    setEditValue(applyMoneyMask(String(Math.round(currentAmount * 100))));
  }

  async function saveEdit(budgetId: string) {
    const amount = parseMoneyInput(editValue);
    if (amount > 0) {
      await updateBudget(budgetId, { limitAmount: amount });
    }
    setEditingBudgetId(null);
    setEditValue('');
  }

  function cancelEdit() {
    setEditingBudgetId(null);
    setEditValue('');
  }

  async function handleAdd() {
    if (!addCategoryId || !addAmount) return;
    const amount = parseMoneyInput(addAmount);
    if (amount <= 0) return;
    await addBudget({
      categoryId: addCategoryId,
      monthYear,
      limitAmount: amount,
    });
    setAddCategoryId('');
    setAddAmount('');
    setShowAddForm(false);
  }

  async function handleDelete(budgetId: string) {
    await deleteBudget(budgetId);
  }

  async function copyFromPrevMonth() {
    if (!prevMonthWithBudgets) return;
    const prevBudgets = getBudgetsForMonth(prevMonthWithBudgets);
    const existingCatIds = new Set(monthBudgets.map((b) => b.categoryId));
    for (const pb of prevBudgets) {
      if (!existingCatIds.has(pb.categoryId)) {
        await addBudget({
          categoryId: pb.categoryId,
          monthYear,
          limitAmount: pb.limitAmount,
        });
      }
    }
  }

  function getCategoryLabel(catId: string): string {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return 'Categoria';
    if (cat.parentId) {
      const parent = categories.find((c) => c.id === cat.parentId);
      return parent ? `${parent.name} > ${cat.name}` : cat.name;
    }
    return cat.name;
  }

  function renderProgressBar(pct: number, isOver: boolean) {
    const barPct = Math.min(pct, 100);
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isOver ? 'bg-accent-red' : 'bg-accent'
            }`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <span
          className={`text-[10px] w-12 text-right font-mono ${
            isOver ? 'text-accent-red font-bold' : 'text-text-secondary'
          }`}
        >
          {pct.toFixed(1)}%
        </span>
      </div>
    );
  }

  function renderBudgetRow(row: BudgetRow, indent = false) {
    const isOver = row.realizado > row.meta;

    return (
      <div
        key={row.budgetId}
        className={`grid grid-cols-[1fr_repeat(4,_minmax(90px,_120px))_32px] items-center gap-2 px-4 py-3 border-b border-border/40 hover:bg-bg-secondary/30 transition-colors ${
          indent ? 'pl-10' : ''
        }`}
      >
        {/* Category name + progress bar */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            {!indent && (
              <div
                className="w-1 h-6 rounded-full flex-shrink-0"
                style={{ backgroundColor: row.color }}
              />
            )}
            <CategoryIcon
              icon={row.icon}
              size={indent ? 12 : 14}
              className="flex-shrink-0"
              style={{ color: row.color }}
            />
            <span
              className={`truncate ${
                indent ? 'text-xs text-text-secondary' : 'text-sm text-text-primary font-medium'
              }`}
            >
              {row.categoryName}
            </span>
          </div>
          {renderProgressBar(row.percentage, isOver)}
        </div>

        {/* Meta (editable) */}
        <div className="text-right">
          {editingBudgetId === row.budgetId ? (
            <div className="flex items-center gap-1 justify-end">
              <input
                ref={editInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(applyMoneyMask(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit(row.budgetId);
                  if (e.key === 'Escape') cancelEdit();
                }}
                className="w-20 text-right text-xs bg-bg-secondary border border-accent rounded px-1.5 py-1 text-text-primary focus:outline-none"
              />
              <button
                onClick={() => saveEdit(row.budgetId)}
                className="text-accent-green hover:text-accent-green/80"
              >
                <Check size={12} />
              </button>
              <button
                onClick={cancelEdit}
                className="text-accent-red hover:text-accent-red/80"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => startEdit(row.budgetId, row.meta)}
              className="text-xs font-mono text-text-primary hover:text-accent transition-colors"
              title="Clique para editar"
            >
              {formatBRL(row.meta)}
            </button>
          )}
        </div>

        {/* Realizado */}
        <div className="text-right">
          <span
            className={`text-xs font-mono ${
              isOver ? 'text-accent-red font-bold' : 'text-text-primary'
            }`}
          >
            {formatBRL(row.realizado)}
          </span>
        </div>

        {/* A realizar */}
        <div className="text-right">
          <span className="text-xs font-mono text-text-secondary">
            {formatBRL(row.aRealizar)}
          </span>
        </div>

        {/* Excedente */}
        <div className="text-right">
          <span
            className={`text-xs font-mono ${
              row.excedente > 0 ? 'text-accent-red font-bold' : 'text-text-secondary'
            }`}
          >
            {formatBRL(row.excedente)}
          </span>
        </div>

        {/* Delete */}
        <div className="text-center">
          <button
            onClick={() => handleDelete(row.budgetId)}
            className="text-text-secondary hover:text-accent-red transition-colors p-1"
            title="Remover meta"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-col lg:flex-row">
      {/* Left sidebar - Summary */}
      <div className="lg:w-72 flex-shrink-0 space-y-4">
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-3 border-b border-border">
            <MonthSelector
              value={monthYear}
              onChange={setMonthYear}
              months={availableMonths}
            />
          </div>

          <div className="p-4 space-y-3">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              Categorias definidas
            </h3>

            {/* Overall progress bar */}
            {grandTotalMeta > 0 && (
              <div className="space-y-1">
                {renderProgressBar(
                  grandTotalPct,
                  grandTotalRealizado > grandTotalMeta
                )}
              </div>
            )}

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-secondary">Total das metas</span>
                <span className="text-text-primary font-bold font-mono">
                  {formatBRL(grandTotalMeta)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Total confirmado</span>
                <span className="text-accent-red font-bold font-mono">
                  -{formatBRL(grandTotalRealizado)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Total a realizar</span>
                <span className="text-text-primary font-mono">
                  {formatBRL(grandTotalARealizar)}
                </span>
              </div>
              {grandTotalExcedente > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Excedente</span>
                  <span className="text-accent-red font-bold font-mono">
                    {formatBRL(grandTotalExcedente)}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <h4 className="text-xs font-bold text-text-primary">
                Total do mes
              </h4>
              {grandTotalMeta > 0 && (
                <div className="space-y-1">
                  {renderProgressBar(
                    grandTotalPct,
                    grandTotalRealizado > grandTotalMeta
                  )}
                </div>
              )}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Meta definida</span>
                  <span className="text-text-primary font-mono">
                    {formatBRL(grandTotalMeta)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Total confirmado</span>
                  <span className="text-accent-red font-mono">
                    -{formatBRL(grandTotalRealizado)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Total a realizar</span>
                  <span className="text-text-primary font-mono">
                    {formatBRL(grandTotalARealizar)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:bg-accent/90 transition-colors"
          >
            <Plus size={14} />
            Adicionar meta
          </button>

          {prevMonthWithBudgets && monthBudgets.length === 0 && (
            <button
              onClick={copyFromPrevMonth}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent transition-colors"
            >
              <Copy size={14} />
              Copiar do mes anterior
            </button>
          )}
        </div>
      </div>

      {/* Main area - Budget list */}
      <div className="flex-1 min-w-0">
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_repeat(4,_minmax(90px,_120px))_32px] items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
            <span>Situacao confirmada</span>
            <span className="text-right">Meta</span>
            <span className="text-right">Realizado</span>
            <span className="text-right">A realizar</span>
            <span className="text-right">Excedente</span>
            <span />
          </div>

          {/* Budget rows */}
          {budgetGroups.length === 0 ? (
            <div className="p-8 text-center text-text-secondary text-sm">
              Nenhuma meta definida para este mes.
              <br />
              <span className="text-xs">
                Clique em "Adicionar meta" para comecar.
              </span>
            </div>
          ) : (
            <div>
              {budgetGroups.map((group) => (
                <div key={group.parentId}>
                  {/* Parent row */}
                  {group.parentRow && renderBudgetRow(group.parentRow)}

                  {/* Sub rows */}
                  {group.subRows.map((sub) => renderBudgetRow(sub, true))}
                </div>
              ))}

              {/* Grand total */}
              {budgetGroups.length > 0 && (
                <div className="grid grid-cols-[1fr_repeat(4,_minmax(90px,_120px))_32px] items-center gap-2 px-4 py-3 bg-bg-secondary/50 border-t border-border">
                  <div className="space-y-1">
                    <span className="text-sm font-bold text-text-primary">
                      Total
                    </span>
                    {renderProgressBar(
                      grandTotalPct,
                      grandTotalRealizado > grandTotalMeta
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono font-bold text-text-primary">
                      {formatBRL(grandTotalMeta)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-mono font-bold ${
                        grandTotalRealizado > grandTotalMeta
                          ? 'text-accent-red'
                          : 'text-text-primary'
                      }`}
                    >
                      {formatBRL(grandTotalRealizado)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono text-text-secondary">
                      {formatBRL(grandTotalARealizar)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-mono ${
                        grandTotalExcedente > 0
                          ? 'text-accent-red font-bold'
                          : 'text-text-secondary'
                      }`}
                    >
                      {formatBRL(grandTotalExcedente)}
                    </span>
                  </div>
                  <div />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add budget modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-4">
            <h3 className="text-sm font-bold text-text-primary">
              Adicionar meta de despesa
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  Categoria
                </label>
                <select
                  value={addCategoryId}
                  onChange={(e) => setAddCategoryId(e.target.value)}
                  className="w-full text-xs bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">Selecione uma categoria</option>
                  {availableCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.parentId ? `    ${getCategoryLabel(cat.id)}` : cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  Valor da meta (R$)
                </label>
                <input
                  type="text"
                  value={addAmount}
                  onChange={(e) => setAddAmount(applyMoneyMask(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                  }}
                  placeholder="0,00"
                  className="w-full text-xs bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setAddCategoryId('');
                  setAddAmount('');
                }}
                className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary border border-border rounded transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdd}
                disabled={!addCategoryId || !addAmount || parseMoneyInput(addAmount) <= 0}
                className="px-4 py-2 text-xs bg-accent text-bg-primary font-bold rounded hover:bg-accent/90 transition-colors disabled:opacity-30"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
