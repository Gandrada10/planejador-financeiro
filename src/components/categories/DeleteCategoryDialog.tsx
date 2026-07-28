import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Category, CategoryRule, Transaction, Budget } from '../../types';

interface Props {
  /** Categoria que o usuário mandou apagar. */
  target: Category;
  categories: Category[];
  transactions: Transaction[];
  rules: CategoryRule[];
  budgets: Budget[];
  onCancel: () => void;
  /** destinationId `null` = deixar os lançamentos sem categoria. */
  onConfirm: (destinationId: string | null) => Promise<void> | void;
}

/**
 * Apagar categoria com DESTINO obrigatório para o que aponta para ela.
 *
 * Antes a exclusão era imediata e silenciosa: o documento sumia e lançamentos,
 * regras e metas ficavam apontando para um id que não existe mais — some da
 * lista, some dos totais por categoria, e não há como descobrir o que era.
 *
 * Apagar uma categoria-MÃE leva as filhas junto (elas ficariam órfãs, com
 * parentId apontando para o vazio), então tudo que está nelas também é movido.
 * O diálogo diz isso na cara antes de confirmar.
 */
export function DeleteCategoryDialog({
  target,
  categories,
  transactions,
  rules,
  budgets,
  onCancel,
  onConfirm,
}: Props) {
  const [destination, setDestination] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const doomed = useMemo(() => {
    const subs = categories.filter((c) => c.parentId === target.id);
    return { subs, ids: new Set([target.id, ...subs.map((s) => s.id)]) };
  }, [categories, target.id]);

  const impact = useMemo(() => {
    let txCount = 0;
    let linkCount = 0;
    for (const t of transactions) {
      if (t.categoryId && doomed.ids.has(t.categoryId)) txCount++;
      if (t.reimbursementPrevCategoryId && doomed.ids.has(t.reimbursementPrevCategoryId)) linkCount++;
    }
    return {
      txCount,
      linkCount,
      ruleCount: rules.filter((r) => doomed.ids.has(r.categoryId)).length,
      budgetCount: budgets.filter((b) => doomed.ids.has(b.categoryId)).length,
    };
  }, [transactions, rules, budgets, doomed.ids]);

  // Não dá para mandar os lançamentos para uma categoria que também vai sumir.
  // Só categorias do MESMO tipo entram: mover despesa para uma categoria de
  // receita quebraria todos os totais.
  const options = useMemo(() => {
    const ok = categories.filter(
      (c) => !doomed.ids.has(c.id) && (c.type === target.type || c.type === 'ambos' || target.type === 'ambos'),
    );
    const roots = ok.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return roots.map((r) => ({
      root: r,
      subs: ok.filter((c) => c.parentId === r.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    }));
  }, [categories, doomed.ids, target.type]);

  const nothingToMove = impact.txCount === 0 && impact.ruleCount === 0 && impact.linkCount === 0;
  // Com lançamentos em jogo, escolher o destino é obrigatório — inclusive a
  // opção explícita de deixar sem categoria, para ninguém apagar no automático.
  const canConfirm = nothingToMove || destination !== '';

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(destination === '__none' || destination === '' ? null : destination);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-bg-card border border-border rounded-card w-full max-w-md max-h-full overflow-auto p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={16} className="text-status-warn flex-shrink-0" />
            <h3 className="text-title font-semibold text-text-primary truncate">
              Excluir “{target.name}”
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar"
            className="tap p-1 -m-1 text-ink-3 hover:text-text-primary transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {doomed.subs.length > 0 && (
          <p className="text-body text-text-secondary">
            As {doomed.subs.length} subcategorias de “{target.name}” também serão excluídas:{' '}
            <span className="text-text-primary">{doomed.subs.map((s) => s.name).join(', ')}</span>.
          </p>
        )}

        {nothingToMove ? (
          <p className="text-body text-text-secondary">
            Nada aponta para {doomed.subs.length > 0 ? 'essas categorias' : 'essa categoria'} — a
            exclusão não afeta nenhum lançamento.
          </p>
        ) : (
          <>
            <div className="text-body text-text-secondary space-y-1">
              <p>Isto vai afetar:</p>
              <ul className="text-caption space-y-0.5 pl-1">
                {impact.txCount > 0 && (
                  <li>
                    <span className="text-text-primary tnum">{impact.txCount}</span>{' '}
                    {impact.txCount === 1 ? 'lançamento' : 'lançamentos'}
                  </li>
                )}
                {impact.linkCount > 0 && (
                  <li>
                    <span className="text-text-primary tnum">{impact.linkCount}</span>{' '}
                    {impact.linkCount === 1 ? 'reembolso vinculado' : 'reembolsos vinculados'}
                  </li>
                )}
                {impact.ruleCount > 0 && (
                  <li>
                    <span className="text-text-primary tnum">{impact.ruleCount}</span>{' '}
                    {impact.ruleCount === 1
                      ? 'regra de categorização'
                      : 'regras de categorização'}
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-1">
              <label className="text-caption text-text-secondary block" htmlFor="destino-categoria">
                Mover tudo para
              </label>
              <select
                id="destino-categoria"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="tap w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-body focus:outline-none focus:border-accent"
              >
                <option value="" disabled>
                  Escolha uma categoria…
                </option>
                {options.map(({ root, subs }) => (
                  <optgroup key={root.id} label={root.name}>
                    <option value={root.id}>{root.name}</option>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {'  '}
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="__none">Deixar sem categoria</option>
              </select>
            </div>
          </>
        )}

        {impact.budgetCount > 0 && (
          <p className="text-caption text-ink-3">
            {impact.budgetCount === 1 ? 'A meta definida' : `As ${impact.budgetCount} metas definidas`}{' '}
            para {doomed.subs.length > 0 ? 'essas categorias' : 'essa categoria'}{' '}
            {impact.budgetCount === 1 ? 'será excluída' : 'serão excluídas'} — mover limite de gasto
            para outra categoria somaria dois limites no mesmo mês.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm || busy}
            className="tap flex-1 px-4 py-2 bg-accent-red text-white text-body font-semibold rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {busy ? 'Excluindo…' : 'Excluir categoria'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="tap px-4 py-2 bg-bg-secondary border border-border text-text-secondary text-body rounded hover:text-text-primary transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
