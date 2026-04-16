import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Category, Project, Transaction } from '../../types';

export type BatchEditableField =
  | 'categoryId'
  | 'account'
  | 'familyMember'
  | 'titular'
  | 'projectId';

interface Props {
  count: number;
  categories: Category[];
  projects?: Project[];
  accountNames?: string[];
  memberNames?: string[];
  /** Fields to offer. Defaults to all. */
  fields?: BatchEditableField[];
  onApply: (updates: Partial<Transaction>) => Promise<void> | void;
  onClose: () => void;
}

export function BatchEditModal({
  count,
  categories,
  projects = [],
  accountNames = [],
  memberNames = [],
  fields = ['categoryId', 'account', 'familyMember', 'projectId'],
  onApply,
  onClose,
}: Props) {
  const [categoryId, setCategoryId] = useState<string>('');
  const [account, setAccount] = useState<string>('');
  const [familyMember, setFamilyMember] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [applying, setApplying] = useState(false);

  const categoryOptions = useMemo(() => {
    const parents = categories.filter((c) => !c.parentId);
    const opts: { id: string; label: string; isChild: boolean }[] = [];
    for (const parent of parents) {
      opts.push({ id: parent.id, label: parent.name, isChild: false });
      const children = categories.filter((c) => c.parentId === parent.id);
      for (const child of children) {
        opts.push({ id: child.id, label: `${parent.name} / ${child.name}`, isChild: true });
      }
    }
    for (const cat of categories) {
      if (cat.parentId && !parents.some((p) => p.id === cat.parentId)) {
        opts.push({ id: cat.id, label: cat.name, isChild: true });
      }
    }
    return opts;
  }, [categories]);

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects]
  );

  const SENTINEL_KEEP = '__keep__';
  const SENTINEL_CLEAR = '__clear__';

  function resolveValue<T>(selected: string, keep: T, clear: T, real: (v: string) => T): T | undefined {
    if (selected === '' || selected === SENTINEL_KEEP) return undefined;
    if (selected === SENTINEL_CLEAR) return clear;
    return real(selected);
  }

  async function handleApply() {
    const updates: Partial<Transaction> = {};

    if (fields.includes('categoryId')) {
      const v = resolveValue<string | null>(categoryId, null, null, (s) => s);
      if (v !== undefined) updates.categoryId = v;
    }
    if (fields.includes('account')) {
      const v = resolveValue<string>(account, '', '', (s) => s);
      if (v !== undefined && v !== '') updates.account = v;
    }
    if (fields.includes('familyMember')) {
      const v = resolveValue<string>(familyMember, '', '', (s) => s);
      if (v !== undefined) updates.familyMember = v;
    }
    if (fields.includes('projectId')) {
      const v = resolveValue<string | null>(projectId, null, null, (s) => s);
      if (v !== undefined) updates.projectId = v;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setApplying(true);
    try {
      await onApply(updates);
    } finally {
      setApplying(false);
      onClose();
    }
  }

  const changeCount =
    (categoryId && categoryId !== SENTINEL_KEEP ? 1 : 0) +
    (account && account !== SENTINEL_KEEP ? 1 : 0) +
    (familyMember && familyMember !== SENTINEL_KEEP ? 1 : 0) +
    (projectId && projectId !== SENTINEL_KEEP ? 1 : 0);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-lg w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Edicao em lote</h3>
            <p className="text-[11px] text-text-secondary mt-0.5">
              {count} lancamento{count === 1 ? '' : 's'} selecionado{count === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-[11px] text-text-secondary">
            Apenas os campos alterados serao aplicados aos itens selecionados.
          </p>

          {fields.includes('categoryId') && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Categoria</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
              >
                <option value={SENTINEL_KEEP}>— Nao alterar —</option>
                <option value={SENTINEL_CLEAR}>Sem categoria</option>
                {categoryOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.isChild ? `\u00A0\u00A0${opt.label}` : opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {fields.includes('account') && accountNames.length > 0 && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Conta</label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
              >
                <option value={SENTINEL_KEEP}>— Nao alterar —</option>
                {accountNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}

          {fields.includes('familyMember') && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Membro</label>
              {memberNames.length > 0 ? (
                <select
                  value={familyMember}
                  onChange={(e) => setFamilyMember(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
                >
                  <option value={SENTINEL_KEEP}>— Nao alterar —</option>
                  <option value={SENTINEL_CLEAR}>Sem membro</option>
                  {memberNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={familyMember === SENTINEL_KEEP ? '' : familyMember}
                  onChange={(e) => setFamilyMember(e.target.value)}
                  placeholder="Nome do membro (vazio = nao alterar)"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
                />
              )}
            </div>
          )}

          {fields.includes('projectId') && (
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Projeto</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
              >
                <option value={SENTINEL_KEEP}>— Nao alterar —</option>
                <option value={SENTINEL_CLEAR}>Sem projeto</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
          >
            Cancelar
          </button>
          <button
            onClick={handleApply}
            disabled={applying || changeCount === 0}
            className="px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40"
          >
            {applying ? 'Aplicando...' : `Aplicar${changeCount > 0 ? ` (${changeCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
