import { formatBRL } from '../../lib/utils';

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Dashboard</h2>
        <span className="text-xs text-text-secondary">Marco 2026</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Receitas</p>
          <p className="text-xl font-bold text-accent-green">{formatBRL(0)}</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Despesas</p>
          <p className="text-xl font-bold text-accent-red">{formatBRL(0)}</p>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Saldo</p>
          <p className="text-xl font-bold text-accent">{formatBRL(0)}</p>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
        Importe seus extratos para comecar a ver dados aqui.
      </div>
    </div>
  );
}
