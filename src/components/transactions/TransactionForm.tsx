import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import type { Transaction, Category } from '../../types';

interface Props {
  onSubmit: (data: Omit<Transaction, 'id' | 'createdAt'>) => void;
  onClose: () => void;
  titularNames?: string[];
  categories?: Category[];
  accountNames?: string[];
}

export function TransactionForm({ onSubmit, onClose, titularNames = [], categories = [], accountNames = [] }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'despesa' | 'receita'>('despesa');
  const [account, setAccount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [familyMember, setFamilyMember] = useState('');
  const [installments, setInstallments] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || !description) return;
    const totalInst = installments ? parseInt(installments, 10) : null;
    onSubmit({
      date: new Date(date + 'T12:00:00'),
      purchaseDate: purchaseDate ? new Date(purchaseDate + 'T12:00:00') : null,
      description,
      amount: type === 'despesa' ? -Math.abs(value) : Math.abs(value),
      account,
      familyMember,
      titular: '',
      installmentNumber: totalInst ? 1 : null,
      totalInstallments: totalInst || null,
      cardNumber: null,
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
              <label className={labelClass}>Data</label>
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

          <div>
            <label className={labelClass}>Parcelas (total)</label>
            <input tabIndex={6} type="number" min="2" value={installments} onChange={(e) => setInstallments(e.target.value)} className={inputClass} placeholder="Ex: 10" />
          </div>

          {installments && parseInt(installments, 10) >= 2 && (
            <div>
              <label className={labelClass}>Data da compra original</label>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClass} />
              <p className="text-[10px] text-text-secondary mt-1">Quando a compra foi feita (se diferente da data da fatura)</p>
            </div>
          )}

          <div>
            <label className={labelClass}>Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">Sem categoria</option>
              {categories
                .filter((c) => c.type === 'ambos' || c.type === type)
                .map((cat) => (
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
