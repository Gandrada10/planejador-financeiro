import { useState, useEffect, useMemo } from 'react';
import { Check, X, Trash2 } from 'lucide-react';

import type { Transaction, Category, Account, Project } from '../../types';
import { applyMoneyMask, parseMoneyInput, filterCategoriesByAmount } from '../../lib/utils';

interface Props {
  transaction: Transaction;
  onSave: (id: string, data: Partial<Transaction>) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  categories?: Category[];
  accounts?: Account[];
  accountNames?: string[];
  titularNames?: string[];
  projects?: Project[];
}

function toDateInputValue(date: Date | null): string {
  if (!date) return '';
  return date.toISOString().split('T')[0];
}

export function TransactionEditModal({
  transaction,
  onSave,
  onDelete,
  onClose,
  categories = [],
  accounts = [],
  accountNames = [],
  titularNames = [],
  projects = [],
}: Props) {
  const [date, setDate] = useState(toDateInputValue(transaction.date));
  const [purchaseDate, setPurchaseDate] = useState(toDateInputValue(transaction.purchaseDate));
  const [description, setDescription] = useState(transaction.description);
  const initialAmountCents = Math.round(Math.abs(transaction.amount) * 100);
  const [amount, setAmount] = useState(
    initialAmountCents > 0 ? applyMoneyMask(String(initialAmountCents)) : ''
  );
  const [type, setType] = useState<'despesa' | 'receita'>(transaction.amount >= 0 ? 'receita' : 'despesa');
  const [account, setAccount] = useState(transaction.account);
  const [categoryId, setCategoryId] = useState(transaction.categoryId || '');
  const [familyMember, setFamilyMember] = useState(transaction.familyMember || '');
  const [installmentNumber, setInstallmentNumber] = useState(
    transaction.installmentNumber ? String(transaction.installmentNumber) : ''
  );
  const [totalInstallments, setTotalInstallments] = useState(
    transaction.totalInstallments ? String(transaction.totalInstallments) : ''
  );
  const [projectId, setProjectId] = useState(transaction.projectId || '');
  const [notes, setNotes] = useState(transaction.notes || '');

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.name === account),
    [accounts, account]
  );
  const isCard = selectedAccount?.type === 'cartao';
  const filteredCategories = filterCategoriesByAmount(categories, type === 'despesa' ? -1 : 1);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseMoneyInput(amount);
    if (!value || !description.trim() || !date) return;

    const signedAmount = type === 'despesa' ? -Math.abs(value) : Math.abs(value);
    const totalInst = totalInstallments ? parseInt(totalInstallments, 10) : null;
    const instNum = installmentNumber ? parseInt(installmentNumber, 10) : null;

    const data: Partial<Transaction> = {
      date: new Date(date + 'T12:00:00'),
      purchaseDate: purchaseDate ? new Date(purchaseDate + 'T12:00:00') : null,
      description: description.trim(),
      amount: signedAmount,
      account,
      familyMember: familyMember.trim(),
      categoryId: categoryId || null,
      installmentNumber: totalInst ? (instNum || 1) : null,
      totalInstallments: totalInst || null,
      projectId: projectId || null,
      notes,
    };

    onSave(transaction.id, data);
    onClose();
  }

  function handleDelete() {
    if (!onDelete) return;
    const ok = window.confirm('Tem certeza que deseja excluir este lançamento?');
    if (!ok) return;
    onDelete(transaction.id);
    onClose();
  }

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] text-text-secondary mb-1 uppercase tracking-wider';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg-card z-10">
          <h3 className="text-sm font-bold text-text-primary">Editar Lançamento</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('despesa')}
              className={`flex-1 py-1.5 text-xs font-bold rounded ${type === 'despesa' ? 'bg-accent-red text-white' : 'bg-bg-secondary text-text-secondary'}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType('receita')}
              className={`flex-1 py-1.5 text-xs font-bold rounded ${type === 'receita' ? 'bg-accent-green text-white' : 'bg-bg-secondary text-text-secondary'}`}
            >
              Receita
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{isCard ? 'Competência' : 'Data'}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Valor (R$)</label>
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(applyMoneyMask(e.target.value))}
                className={inputClass}
                placeholder="0,00"
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>{isCard ? 'Data da compra' : 'Data de competência (opcional)'}</label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Descrição</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Conta/Cartão</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass}>
                <option value="">Selecione...</option>
                {accountNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Membro</label>
              {titularNames.length > 0 ? (
                <select value={familyMember} onChange={(e) => setFamilyMember(e.target.value)} className={inputClass}>
                  <option value="">Selecione...</option>
                  {titularNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={familyMember} onChange={(e) => setFamilyMember(e.target.value)} className={inputClass} placeholder="Quem comprou?" />
              )}
            </div>
          </div>

          <div>
            <label className={labelClass}>Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">Sem categoria</option>
              {filteredCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Parcela</label>
              <input
                type="number"
                min="1"
                value={installmentNumber}
                onChange={(e) => setInstallmentNumber(e.target.value)}
                className={inputClass}
                placeholder="Ex: 1"
              />
            </div>
            <div>
              <label className={labelClass}>Total de parcelas</label>
              <input
                type="number"
                min="1"
                value={totalInstallments}
                onChange={(e) => setTotalInstallments(e.target.value)}
                className={inputClass}
                placeholder="Ex: 12"
              />
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label className={labelClass}>Projeto</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                <option value="">Nenhum</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelClass}>Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90 flex items-center justify-center gap-2"
            >
              <Check size={16} />
              Salvar
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 border border-accent-red/40 text-accent-red text-sm rounded hover:bg-accent-red/10 flex items-center gap-1.5"
                title="Excluir lançamento"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
