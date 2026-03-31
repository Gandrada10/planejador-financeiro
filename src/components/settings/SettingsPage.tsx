import { useState } from 'react';
import { Plus, Trash2, CreditCard, Wallet, Lock, LockOpen, Calendar } from 'lucide-react';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useAccounts } from '../../hooks/useAccounts';
import { useBillingCycles } from '../../hooks/useBillingCycles';
import type { Account } from '../../types';
import { getMonthLabel } from '../../lib/utils';

const ACCOUNT_TYPES: { value: Account['type']; label: string }[] = [
  { value: 'corrente', label: 'Conta Corrente' },
  { value: 'cartao', label: 'Cartao de Credito' },
  { value: 'poupanca', label: 'Poupanca' },
  { value: 'investimento', label: 'Investimento' },
  { value: 'outro', label: 'Outro' },
];

function monthYearOptions(): string[] {
  const opts: string[] = [];
  const now = new Date();
  for (let i = 12; i >= -2; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    opts.push(`${y}-${m}`);
  }
  return opts.reverse();
}

export function SettingsPage() {
  const { mappings, loading, addMapping, deleteMapping } = useTitularMappings();
  const { accounts, loading: loadingAccounts, addAccount, deleteAccount } = useAccounts();
  const { cycles, loading: loadingCycles, createCycle, closeCycle, reopenCycle, deleteCycle } = useBillingCycles();

  const [cardDigits, setCardDigits] = useState('');
  const [titularName, setTitularName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<Account['type']>('corrente');
  const [accountBank, setAccountBank] = useState('');

  // Billing cycle form
  const [cycleAccountId, setCycleAccountId] = useState('');
  const [cycleMonth, setCycleMonth] = useState('');

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!cardDigits || !titularName) return;
    await addMapping({ cardLastDigits: cardDigits.slice(-4), titularName: titularName.trim() });
    setCardDigits(''); setTitularName('');
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) return;
    await addAccount({ name: accountName.trim(), type: accountType, bank: accountBank.trim() });
    setAccountName(''); setAccountType('corrente'); setAccountBank('');
  }

  async function handleCreateCycle(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleAccountId || !cycleMonth) return;
    await createCycle(cycleAccountId, cycleMonth);
    setCycleAccountId(''); setCycleMonth('');
  }

  if (loading || loadingAccounts || loadingCycles) {
    return <div className="text-accent text-sm animate-pulse">Carregando configuracoes...</div>;
  }

  const cardAccounts = accounts.filter((a) => a.type === 'cartao');
  const inputClass = 'px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-text-primary">Configuracoes</h2>

      {/* Accounts */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Wallet size={16} className="text-accent" /> Contas e Cartoes
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Cadastre suas contas bancarias e cartoes. Elas aparecerao como opcoes ao registrar transacoes.
          </p>
        </div>
        <form onSubmit={handleAddAccount} className="flex gap-2 flex-wrap">
          <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
            placeholder="Nome (ex: Nubank, Itau CC)" className={`${inputClass} flex-1 min-w-[150px]`} required />
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as Account['type'])} className={`${inputClass} w-44`}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="text" value={accountBank} onChange={(e) => setAccountBank(e.target.value)}
            placeholder="Banco (opcional)" className={`${inputClass} w-36`} />
          <button type="submit" disabled={!accountName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
            <Plus size={14} /> Adicionar
          </button>
        </form>
        {accounts.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhuma conta cadastrada.</p>
        ) : (
          <div className="space-y-1">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-text-primary font-bold">{a.name}</span>
                  <span className="text-[10px] text-text-secondary uppercase">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}</span>
                  {a.bank && <span className="text-text-secondary">({a.bank})</span>}
                </div>
                <button onClick={() => deleteAccount(a.id)} className="text-text-secondary hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Billing Cycles */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Calendar size={16} className="text-accent" /> Faturas de Cartao de Credito
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Gerencie o status de cada fatura por cartao e mes. Faturas encerradas emitem alerta ao tentar adicionar lancamentos.
          </p>
        </div>

        {cardAccounts.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhum cartao de credito cadastrado. Adicione uma conta do tipo "Cartao de Credito" acima.</p>
        ) : (
          <>
            <form onSubmit={handleCreateCycle} className="flex gap-2 flex-wrap">
              <select value={cycleAccountId} onChange={(e) => setCycleAccountId(e.target.value)} className={`${inputClass} flex-1 min-w-[150px]`} required>
                <option value="">Selecione o cartao...</option>
                {cardAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={cycleMonth} onChange={(e) => setCycleMonth(e.target.value)} className={`${inputClass} w-44`} required>
                <option value="">Selecione o mes...</option>
                {monthYearOptions().map((m) => <option key={m} value={m}>{getMonthLabel(m)}</option>)}
              </select>
              <button type="submit" disabled={!cycleAccountId || !cycleMonth}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
                <Plus size={14} /> Criar Fatura
              </button>
            </form>

            {cycles.length === 0 ? (
              <p className="text-xs text-text-secondary">Nenhuma fatura criada.</p>
            ) : (
              <div className="space-y-1">
                {cycles.map((cycle) => {
                  const account = accounts.find((a) => a.id === cycle.accountId);
                  return (
                    <div key={cycle.id} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs">
                      <div className="flex items-center gap-3">
                        <span className="text-text-primary font-bold">{account?.name ?? '—'}</span>
                        <span className="text-text-secondary">{getMonthLabel(cycle.monthYear)}</span>
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          cycle.status === 'closed'
                            ? 'bg-accent-red/10 text-accent-red'
                            : 'bg-accent-green/10 text-accent-green'
                        }`}>
                          {cycle.status === 'closed'
                            ? <><Lock size={10} /> Encerrada</>
                            : <><LockOpen size={10} /> Aberta</>
                          }
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {cycle.status === 'open' ? (
                          <button
                            onClick={() => {
                              if (confirm(`Encerrar fatura de ${account?.name} — ${getMonthLabel(cycle.monthYear)}?`)) {
                                closeCycle(cycle.id);
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-accent-red/10 text-accent-red rounded hover:bg-accent-red/20"
                          >
                            <Lock size={10} /> Encerrar
                          </button>
                        ) : (
                          <button
                            onClick={() => reopenCycle(cycle.id)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-accent-green/10 text-accent-green rounded hover:bg-accent-green/20"
                          >
                            <LockOpen size={10} /> Reabrir
                          </button>
                        )}
                        <button onClick={() => deleteCycle(cycle.id)} className="text-text-secondary hover:text-accent-red p-1">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Titular Mappings */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <CreditCard size={16} className="text-accent" /> Mapeamento de Titulares
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Associe os ultimos 4 digitos do cartao ao nome do titular para identificacao automatica na importacao.
          </p>
        </div>
        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
          <input type="text" value={cardDigits} onChange={(e) => setCardDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 digitos do cartao" className={`${inputClass} w-40`} maxLength={4} />
          <input type="text" value={titularName} onChange={(e) => setTitularName(e.target.value)}
            placeholder="Nome do titular" className={`${inputClass} flex-1 min-w-[150px]`} />
          <button type="submit" disabled={cardDigits.length !== 4 || !titularName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
            <Plus size={14} /> Adicionar
          </button>
        </form>
        {mappings.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhum mapeamento cadastrado.</p>
        ) : (
          <div className="space-y-1">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-accent font-mono font-bold">**** {m.cardLastDigits}</span>
                  <span className="text-text-secondary">→</span>
                  <span className="text-text-primary">{m.titularName}</span>
                </div>
                <button onClick={() => deleteMapping(m.id)} className="text-text-secondary hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
