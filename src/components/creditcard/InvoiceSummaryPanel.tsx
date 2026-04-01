import { useState } from 'react';
import { Lock, LockOpen, DollarSign } from 'lucide-react';
import { formatBRL, formatDate } from '../../lib/utils';
import type { BillingCycle, Account } from '../../types';

interface TitularTotal {
  name: string;
  total: number;
}

interface Props {
  account: Account;
  cycle: BillingCycle | undefined;
  monthYear: string;
  totalExpenses: number;
  totalCredits: number;
  totalInvoice: number;
  previousBalance: number;
  titularTotals: TitularTotal[];
  futureInstallmentsCount: number;
  futureInstallmentsTotal: number;
  onCloseCycle: () => void;
  onReopenCycle: () => void;
  onRegisterPayment: (amount: number, date: Date) => void;
}

export function InvoiceSummaryPanel({
  account,
  cycle,
  totalExpenses,
  totalCredits,
  totalInvoice,
  previousBalance,
  titularTotals,
  futureInstallmentsCount,
  futureInstallmentsTotal,
  onCloseCycle,
  onReopenCycle,
  onRegisterPayment,
}: Props) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const paidAmount = cycle?.paidAmount || 0;
  const valueToPay = totalInvoice + previousBalance - paidAmount;

  const closingDay = account.closingDay;
  const dueDay = account.dueDay;
  const creditLimit = account.creditLimit;

  function handlePay() {
    const amount = parseFloat(payAmount.replace(',', '.'));
    if (!amount || amount <= 0) return;
    onRegisterPayment(amount, new Date(payDate + 'T12:00:00'));
    setShowPayForm(false);
    setPayAmount('');
  }

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
      {/* Fatura atual */}
      <div className="text-center border-b border-border pb-3">
        <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Fatura atual (R$)</p>
        <p className={`text-2xl font-bold ${totalInvoice >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
          {formatBRL(totalInvoice)}
        </p>
      </div>

      {/* Dates */}
      {(closingDay || dueDay) && (
        <div className="space-y-1 text-xs border-b border-border pb-3">
          {closingDay && (
            <div className="flex justify-between">
              <span className="text-text-secondary">Fechamento</span>
              <span className="text-text-primary">Dia {closingDay}</span>
            </div>
          )}
          {dueDay && (
            <div className="flex justify-between">
              <span className="text-text-secondary">Vencimento</span>
              <span className="text-text-primary">Dia {dueDay}</span>
            </div>
          )}
        </div>
      )}

      {/* Detalhamento */}
      <div className="space-y-1 text-xs border-b border-border pb-3">
        <div className="flex justify-between">
          <span className="text-text-secondary">Saldo anterior</span>
          <span className={previousBalance !== 0 ? 'text-accent-red' : 'text-text-primary'}>{formatBRL(previousBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary">Outros creditos</span>
          <span className="text-accent-green">{formatBRL(totalCredits)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary">Despesas</span>
          <span className="text-accent-red">{formatBRL(totalExpenses)}</span>
        </div>
        {paidAmount > 0 && (
          <div className="flex justify-between">
            <span className="text-text-secondary">Total pago</span>
            <span className="text-accent-green">{formatBRL(paidAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold pt-1 border-t border-border/40">
          <span className="text-text-primary">Valor a pagar</span>
          <span className={valueToPay <= 0 ? 'text-accent-green' : 'text-accent-red'}>{formatBRL(valueToPay)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {cycle?.status === 'open' ? (
          <button
            onClick={() => {
              if (confirm('Encerrar esta fatura?')) onCloseCycle();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent-red/10 text-accent-red text-xs font-bold rounded hover:bg-accent-red/20"
          >
            <Lock size={12} /> Fechar fatura
          </button>
        ) : cycle?.status === 'closed' ? (
          <button
            onClick={onReopenCycle}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent-green/10 text-accent-green text-xs font-bold rounded hover:bg-accent-green/20"
          >
            <LockOpen size={12} /> Reabrir fatura
          </button>
        ) : null}
        <button
          onClick={() => setShowPayForm(!showPayForm)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent/10 text-accent text-xs font-bold rounded hover:bg-accent/20"
        >
          <DollarSign size={12} /> Lancar pagamento
        </button>
      </div>

      {/* Payment form */}
      {showPayForm && (
        <div className="bg-bg-secondary rounded p-3 space-y-2">
          <input
            type="text"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            placeholder="Valor pago"
            className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
          <input
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
          />
          <button
            onClick={handlePay}
            disabled={!payAmount}
            className="w-full px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
          >
            Confirmar pagamento
          </button>
        </div>
      )}

      {/* Parcelas futuras */}
      {futureInstallmentsCount > 0 && (
        <div className="text-xs border-t border-border pt-3">
          <div className="flex justify-between">
            <span className="text-text-secondary">Parcelas futuras</span>
            <span className="text-text-primary">{futureInstallmentsCount} parcelas</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Total futuro</span>
            <span className="text-accent-red">{formatBRL(futureInstallmentsTotal)}</span>
          </div>
        </div>
      )}

      {/* Totais por titular */}
      {titularTotals.length > 1 && (
        <div className="border-t border-border pt-3 space-y-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Totais por cartao (R$)</p>
          {titularTotals.map((t, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-text-primary">{t.name || 'Sem titular'}</span>
              <span className="text-accent-red font-bold">{formatBRL(t.total)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Limite */}
      {creditLimit != null && creditLimit > 0 && (
        <div className="border-t border-border pt-3 space-y-1">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Limite</p>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Limite da conta</span>
            <span className="text-text-primary">{formatBRL(creditLimit)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Utilizado</span>
            <span className="text-accent-red">{formatBRL(Math.abs(totalInvoice))}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">Disponivel</span>
            <span className="text-accent-green">{formatBRL(creditLimit - Math.abs(totalInvoice))}</span>
          </div>
          <div className="w-full h-2 bg-bg-secondary rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.min((Math.abs(totalInvoice) / creditLimit) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
