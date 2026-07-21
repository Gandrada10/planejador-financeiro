import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, AlertTriangle, Pencil } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { useProjects } from '../../hooks/useProjects';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import { TransactionEditModal } from '../transactions/TransactionEditModal';
import { formatBRL, formatDate, getMonthLabel, cn } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

/**
 * Central de alertas (sininho da barra lateral). Primeiro tipo de alerta:
 * NOTAS marcadas como relevantes (`noteAlert`). A fonte de dados vive AQUI, num
 * único provider montado uma vez no Layout — os gatilhos <AlertBell/> (sidebar e
 * header mobile) apenas consomem `count`/`open`, sem duplicar assinaturas do
 * Firestore.
 */

interface AlertsCtxValue {
  count: number;
  open: () => void;
}

const AlertsCtx = createContext<AlertsCtxValue>({ count: 0, open: () => {} });

// eslint-disable-next-line react-refresh/only-export-components
export function useAlerts(): AlertsCtxValue {
  return useContext(AlertsCtx);
}

/** Rótulo legível "Pai / Sub" (ou só o nome) para exibir a categoria na linha. */
function categoryLabel(categories: Category[], id: string | null): string {
  if (!id) return 'Sem categoria';
  const cat = categories.find((c) => c.id === id);
  if (!cat) return 'Sem categoria';
  if (cat.parentId) {
    const parent = categories.find((c) => c.id === cat.parentId);
    return parent ? `${parent.name} / ${cat.name}` : cat.name;
  }
  return cat.name;
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { transactions, updateTransaction, deleteTransaction } = useTransactions();
  const { categories } = useCategories();
  const { accounts, accountNames } = useAccounts();
  const { activeProjects } = useProjects();
  const { memberNames } = useFamilyMembers();
  const { titularNames } = useTitularMappings();
  const { getClosedCycle, reopenCycle } = useBillingCycles();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  // Mesmo invariante do resto do app (TransactionTable/InvoiceTransactionList):
  // editar/excluir uma transação de uma fatura ENCERRADA exige reabri-la antes.
  // O sininho reaproveita o TransactionEditModal (antes órfão), então precisa do
  // mesmo pedágio. Notas/`noteAlert` NÃO passam pelo guard — em todo o app a
  // edição de nota é escrita direta, sem reabrir fatura —, então "Desmarcar"
  // segue livre; só o modal (valor/data/exclusão) é protegido.
  function checkClosedCycle(t: Transaction | null): { cycleId: string; label: string } | null {
    if (!t) return null;
    const account = accounts.find((a) => a.name === t.account && a.type === 'cartao');
    if (!account) return null;
    const closed = getClosedCycle(account.id, t.date, t.billingMonth);
    if (!closed) return null;
    return { cycleId: closed.id, label: `${account.name} — ${getMonthLabel(closed.monthYear)}` };
  }

  // window.confirm é síncrono e bloqueia DENTRO do onSave/onDelete, antes de o
  // modal chamar onClose() — então o prompt aparece com o modal ainda aberto.
  function guardedSave(id: string, data: Partial<Transaction>) {
    const closed = checkClosedCycle(editing);
    if (closed) {
      const ok = window.confirm(
        `A fatura "${closed.label}" está encerrada.\n\nDeseja reabri-la para salvar esta edição?`
      );
      if (!ok) return;
      reopenCycle(closed.cycleId).then(() => updateTransaction(id, data));
      return;
    }
    updateTransaction(id, data);
  }

  function guardedDelete(id: string) {
    const closed = checkClosedCycle(editing);
    if (closed) {
      const ok = window.confirm(
        `A fatura "${closed.label}" está encerrada.\n\nDeseja reabri-la para excluir esta transação?`
      );
      if (!ok) return;
      reopenCycle(closed.cycleId).then(() => deleteTransaction(id));
      return;
    }
    deleteTransaction(id);
  }

  // Alertas ativos: nota marcada E com texto (nota vazia nunca fica no sininho),
  // mais recentes primeiro.
  const alerts = useMemo(
    () =>
      transactions
        .filter((t) => t.noteAlert && (t.notes || '').trim().length > 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [transactions]
  );
  const count = alerts.length;

  // Opções de membro para o modal de edição: nomes canônicos (ou titulares
  // como fallback) + o membro atual de cada alerta, para nunca "sumir" o valor.
  const memberOptions = useMemo(() => {
    const base = memberNames.length > 0 ? memberNames : titularNames;
    const set = new Set<string>(base);
    for (const t of alerts) {
      const name = (t.familyMember || t.titular || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).filter(Boolean).sort();
  }, [memberNames, titularNames, alerts]);

  // Fecha o painel com Esc (o modal de edição tem o seu próprio Esc).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const value = useMemo<AlertsCtxValue>(() => ({ count, open: () => setOpen(true) }), [count]);

  const panel = open
    ? createPortal(
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-bg-card border border-border rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col mt-2 sm:mt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <Bell size={16} className={count > 0 ? 'text-accent-red' : 'text-text-secondary'} />
                Alertas de notas
                <span className="text-text-secondary font-normal">({count})</span>
              </h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="text-text-secondary hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-3 space-y-2">
              {count === 0 ? (
                <div className="p-10 text-center text-text-secondary text-sm">
                  Nenhum alerta ativo.
                  <br />
                  Marque uma nota como <span className="text-accent-red font-semibold">alerta</span> para vê-la aqui.
                </div>
              ) : (
                alerts.map((t) => (
                  <div
                    key={t.id}
                    className="border border-accent-red/30 bg-accent-red/5 rounded-lg overflow-hidden"
                  >
                    {/* Nota (destaque vermelho) + desmarcar */}
                    <div className="flex items-start gap-2 p-3 border-b border-accent-red/20">
                      <AlertTriangle size={15} className="text-accent-red flex-shrink-0 mt-0.5" />
                      <p className="flex-1 text-sm text-text-primary whitespace-pre-wrap break-words min-w-0">
                        {t.notes}
                      </p>
                      <button
                        onClick={() => updateTransaction(t.id, { noteAlert: false })}
                        title="Desmarcar alerta — remove do sininho"
                        className="flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded border border-accent-red/40 text-accent-red hover:bg-accent-red/10 flex items-center gap-1"
                      >
                        <X size={11} /> Desmarcar
                      </button>
                    </div>

                    {/* Linha inteira do lançamento — clicável para editar */}
                    <button
                      onClick={() => {
                        setEditing(t);
                        setOpen(false);
                      }}
                      title="Editar lançamento"
                      className="w-full text-left p-3 hover:bg-bg-secondary/60 transition-colors flex items-center gap-3"
                    >
                      <span className="text-text-secondary text-xs w-14 flex-shrink-0 tnum">
                        {formatDate(t.date)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-text-primary text-xs truncate">{t.description}</span>
                        <span className="block text-text-secondary text-[10px] truncate">
                          {categoryLabel(categories, t.categoryId)}
                          {t.account ? ` · ${t.account}` : ''}
                          {t.familyMember ? ` · ${t.familyMember}` : ''}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'text-xs font-bold tnum flex-shrink-0',
                          t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'
                        )}
                      >
                        {formatBRL(t.amount)}
                      </span>
                      <Pencil size={13} className="text-text-secondary flex-shrink-0" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {count > 0 && (
              <div className="p-3 border-t border-border text-[10px] text-text-secondary">
                Clique na linha para editar o lançamento. Para tirar do sininho, desmarque o alerta — aqui ou na
                própria nota.
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <AlertsCtx.Provider value={value}>
      {children}
      {panel}
      {editing && (
        <TransactionEditModal
          transaction={editing}
          categories={categories}
          accounts={accounts}
          accountNames={accountNames}
          titularNames={memberOptions}
          projects={activeProjects}
          onSave={guardedSave}
          onDelete={guardedDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </AlertsCtx.Provider>
  );
}

interface BellProps {
  collapsed?: boolean;
  variant?: 'sidebar' | 'header';
}

/** Gatilho do sininho. Só consome o contexto — nenhuma assinatura extra. */
export function AlertBell({ collapsed = false, variant = 'sidebar' }: BellProps) {
  const { count, open } = useAlerts();

  // Badge de canto sobre o ícone. O `display` vem do chamador (base sem `flex`)
  // para evitar contagem DUPLICADA: no header é sempre visível; na sidebar só
  // aparece quando o rótulo (com o pill inline) está escondido — ou seja, no
  // modo recolhido em telas lg. Assim nunca se vê o número duas vezes.
  function cornerBadge(displayClass: string) {
    if (count <= 0) return null;
    return (
      <span
        className={cn(
          'absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 items-center justify-center rounded-full bg-accent-red text-white text-[9px] font-bold leading-none',
          displayClass
        )}
      >
        {count > 9 ? '9+' : count}
      </span>
    );
  }

  if (variant === 'header') {
    return (
      <button
        onClick={open}
        aria-label={count > 0 ? `Alertas (${count})` : 'Alertas'}
        title={count > 0 ? `${count} alerta${count !== 1 ? 's' : ''}` : 'Alertas'}
        className={cn(
          'relative transition-colors',
          count > 0 ? 'text-accent-red' : 'text-text-secondary hover:text-text-primary'
        )}
      >
        <Bell size={18} />
        {cornerBadge('flex')}
      </button>
    );
  }

  return (
    <button
      onClick={open}
      title={count > 0 ? `${count} alerta${count !== 1 ? 's' : ''}` : 'Alertas'}
      aria-label={count > 0 ? `Alertas (${count})` : 'Alertas'}
      className={cn(
        'flex items-center gap-3 py-2 text-xs rounded transition-colors w-full',
        collapsed ? 'px-3 lg:px-0 lg:justify-center' : 'px-3',
        count > 0
          ? 'text-accent-red hover:bg-accent-red/10'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
      )}
    >
      <span className="relative flex-shrink-0">
        <Bell size={16} />
        {/* Só quando o rótulo/pill está oculto (recolhido em lg) — senão duplica. */}
        {cornerBadge(collapsed ? 'hidden lg:flex' : 'hidden')}
      </span>
      <span className={cn('flex items-center gap-2', collapsed && 'lg:hidden')}>
        Alertas
        {count > 0 && (
          <span className="ml-auto min-w-[16px] px-1 h-4 flex items-center justify-center rounded-full bg-accent-red/20 text-accent-red text-[9px] font-bold">
            {count}
          </span>
        )}
      </span>
    </button>
  );
}
