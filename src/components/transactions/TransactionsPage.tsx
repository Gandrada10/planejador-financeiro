import { useState, useMemo } from 'react';
import { Upload, Plus, Search } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { TransactionTable } from './TransactionTable';
import { TransactionForm } from './TransactionForm';
import { ImportModal } from './ImportModal';
import { getMonthYear, getMonthLabel } from '../../lib/utils';

export function TransactionsPage() {
  const { transactions, loading, addTransaction, updateTransaction, deleteTransaction, importBatch } = useTransactions();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filterMonth, setFilterMonth] = useState(getMonthYear());
  const [searchText, setSearchText] = useState('');

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filterMonth !== 'all') {
      list = list.filter((t) => getMonthYear(t.date) === filterMonth);
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.account.toLowerCase().includes(q) ||
          t.familyMember.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return list;
  }, [transactions, filterMonth, searchText]);

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando transacoes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-text-primary">Transacoes</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <Plus size={14} /> Nova
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
          >
            <Upload size={14} /> Importar Extrato
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text-secondary" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por descricao, conta, membro, tag..."
            className="w-full pl-8 pr-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          <option value="all">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>{getMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-xs text-text-secondary">
        <span>{filtered.length} transacoes</span>
        <span className="text-accent-green">
          Receitas: R$ {filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        <span className="text-accent-red">
          Despesas: R$ {Math.abs(filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
      </div>

      <TransactionTable
        transactions={filtered}
        onUpdate={updateTransaction}
        onDelete={deleteTransaction}
      />

      {showForm && <TransactionForm onSubmit={addTransaction} onClose={() => setShowForm(false)} />}
      {showImport && (
        <ImportModal
          existingTransactions={transactions}
          onImport={importBatch}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
