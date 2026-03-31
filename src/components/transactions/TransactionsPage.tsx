import { ArrowLeftRight } from 'lucide-react';

export function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Transacoes</h2>
        <button className="flex items-center gap-2 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
          <ArrowLeftRight size={14} />
          Importar Extrato
        </button>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
        Nenhuma transacao ainda. Importe um extrato ou adicione manualmente.
      </div>
    </div>
  );
}
