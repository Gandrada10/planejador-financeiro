import { useState, useMemo } from 'react';
import { Plus, X } from 'lucide-react';

import type { Transaction, Category, Account } from '../../types';
import { getMonthYear, getMonthLabel } from '../../lib/utils';
import { filterCategoriesByAmount } from '../../lib/utils';

interface Props {
  onSubmit: (data: Omit<Transaction, 'id' | 'createdAt'>) => void;
  onClose: () => void;
  titularNames?: string[];
  categories?: Category[];
  accountNames?: string[];
  accounts?: Account[];
}

function invoiceMonthOptions(): string[] {
  const opts: string[] = [];
  const now = new Date();
  for (let i = -2; i <= 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push(getMonthYear(d));
  }
  return opts;
}

export function TransactionForm({ onSubmit, onClose, titularNames = [], categories = [], accountNames = [], accounts = [] }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'despesa' | 'receita'>('despesa');
  const [account, setAccount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [familyMember, setFamilyMember] = useState('');
  const [installments, setInstallments] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState(getMonthYear());

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.name === account),
    [accounts, account]
  );
  const isCard = selectedAccount?.type === 'cartao';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || !description) return;
    const totalInst = installments ? parseInt(installments, 10) : null;

    // For credit cards: date = first day of invoice month (competência), purchaseDate = actual purchase date
    // For other accounts: date = entered date, purchaseDate = null
    const txDate = isCard
      ? new Date(invoiceMonth + '-01T12:00:00')
      : new Date(date + 'T12:00:00');
    const txPurchaseDate = isCard
      ? new Date(date + 'T12:00:00')
      : null;

    onSubmit({
      date: txDate,
      purchaseDate: txPurchaseDate,
      description,
      amount: type === 'despesa' ? -Math.abs(value) : Math.abs(value),
      account,
      familyMember,
      titular: '',
      installmentNumber: totalInst ? 1 : null,
      totalInstallments: totalInst || null,
      cardNumber: null,
      projectId: null,
      pluggyTransactionId: null,
      tags: [],
      notes,
      categoryId: categoryId || null,
      importBatch: null,
      reconciled: false,
      reconciledAt: null,
    });
    onClose();
  }

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] text-text-secondary mb-1 uppercase tracking-wider';
  const filteredCategories = filterCategoriesByAmount(categories, type === 'despesa' ? -1 : 1);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">Nova Transacao</h3>
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
              <label className={labelClass}>{isCard ? 'Data da compra' : 'Data'}</label>
              <input tabIndex={1} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Valor (R$)</label>
              <input tabIndex={2} type="text" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} placeholder="0,00" required />
            </div>
          </div>

          <div>
            <label className={labelClass}>Descricao</label>
            <input tabIndex={3} type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Conta/Cartao</label>
              <select tabIndex={4} value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass}>
                <option value="">Selecione...</option>
                {accountNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Membro</label>
              {titularNames.length > 0 ? (
                <select tabIndex={5} value={familyMember} onChange={(e) => setFamilyMember(e.target.value)} className={inputClass}>
                  <option value="">Selecione...</option>
                  {titularNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input tabIndex={5} type="text" value={familyMember} onChange={(e) => setFamilyMember(e.target.value)} className={inputClass} placeholder="Quem comprou?" />
              )}
            </div>
          </div>

          {/* Invoice month selector — only for credit cards */}
          {isCard && (
            <div>
              <label className={labelClass}>Lancar na fatura de</label>
              <select value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} className={inputClass}>
                {invoiceMonthOptions().map((m) => (
                  <option key={m} value={m}>{getMonthLabel(m)}</option>
                ))}
              </select>
              <p className="text-[10px] text-text-secondary mt-1">
                Mes da fatura em que este lancamento deve aparecer
              </p>
            </div>
          )}

          <div>
            <label className={labelClass}>Parcelas (total)</label>
            <input tabIndex={6} type="number" min="2" value={installments} onChange={(e) => setInstallments(e.target.value)} className={inputClass} placeholder="Ex: 10" />
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

          <div>
            <label className={labelClass}>Observacoes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Adicionar
          </button>
        </form>
      </div>
    </div>
  );
}
