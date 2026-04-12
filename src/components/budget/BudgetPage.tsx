import { useState } from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { ExpenseGoalsTab } from './ExpenseGoalsTab';
import { GoalsEvolutionTab } from './GoalsEvolutionTab';

type Tab = 'despesas' | 'evolucao';

export function BudgetPage() {
  const [activeTab, setActiveTab] = useState<Tab>('despesas');

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-text-primary">Metas de Despesas</h2>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border pb-0">
        {(
          [
            ['despesas', Target, 'Despesas'],
            ['evolucao', TrendingUp, 'Evolucao'],
          ] as [Tab, React.ElementType, string][]
        ).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'text-accent border-accent bg-accent/5'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'despesas' && <ExpenseGoalsTab />}
      {activeTab === 'evolucao' && <GoalsEvolutionTab />}
    </div>
  );
}
