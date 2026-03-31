import { useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Props {
  onSubmit: (data: {
    date: Date;
    description: string;
    amount: number;
    account: string;
    familyMember: string;
    tags: string[];
    notes: string;
    categoryId: null;
    importBatch: null;
  }) => void;
  onClose: () => void;
}

export function TransactionForm({ onSubmit, onClose }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'despesa' | 'receita'>('despesa');
  const [account, setAccount] = useState('');
  const [familyMember, setFamilyMember] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || !description) return;
    onSubmit({
      date: new Date(date + 'T12:00:00'),
      description,
      amount: type === 'despesa' ? -Math.abs(value) : Math.abs(value),
      account,
      familyMember,
      tags: tags ? tags.split(',').map((t) => t.trim()) : [],
      notes,
      categoryId: null,
      importBatch: null,
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
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Valor (R$)</label>
              <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} placeholder="0,00" required />
            </div>
          </div>

          <div>
            <label className={labelClass}>Descricao</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Conta/Banco</label>
              <input type="text" value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass} placeholder="Nubank, Itau..." />
            </div>
            <div>
              <label className={labelClass}>Membro</label>
              <input type="text" value={familyMember} onChange={(e) => setFamilyMember(e.target.value)} className={inputClass} placeholder="Eu, Esposa..." />
            </div>
          </div>

          <div>
            <label className={labelClass}>Tags (separadas por virgula)</label>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} placeholder="viagem, reforma..." />
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
