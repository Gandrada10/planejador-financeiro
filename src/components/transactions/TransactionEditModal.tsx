import { useState, useEffect, useMemo } from 'react';
import { Check, X, Trash2, AlertTriangle } from 'lucide-react';

import type { Transaction, Category, Account, Project } from '../../types';
import { applyMoneyMask, parseMoneyInput, filterCategoriesByAmount, formatBRL } from '../../lib/utils';

/** Prévia da taxa que será gravada, para o número não virar caixa-preta:
 *  o usuário digita "€ 40" e "R$ 242" e vê "R$ 6,05 por EUR" na hora. */
function fxRateLabel(rawFx: string, rawBrl: string, currency: string): string {
  const fx = parseMoneyInput(rawFx);
  const brl = parseMoneyInput(rawBrl);
  if (!fx || !brl) return '—';
  return `${formatBRL(Math.abs(brl) / Math.abs(fx))} por ${currency}`;
}

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
  const [noteAlert, setNoteAlert] = useState(!!transaction.noteAlert);
  const [isReimbursement, setIsReimbursement] = useState(!!transaction.isReimbursement);
  // Moeda estrangeira: texto livre para aceitar o estado VAZIO (gasto em
  // reais, que é a esmagadora maioria). Valor sempre em módulo — o sinal vem
  // do seletor despesa/receita, igual ao valor em reais.
  const [amountFx, setAmountFx] = useState(
    transaction.amountFx != null ? String(Math.abs(transaction.amountFx)).replace('.', ',') : ''
  );
  const [currencyFx, setCurrencyFx] = useState(transaction.currencyFx || '');

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
  // Reembolso abate uma DESPESA, então oferece categorias de despesa mesmo
  // sendo um valor positivo (receita) — a categoria certa é a do gasto abatido.
  const filteredCategories = filterCategoriesByAmount(categories, (type === 'despesa' || isReimbursement) ? -1 : 1);

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
      // Só faz sentido em valor positivo (receita); em despesa, força false.
      isReimbursement: type === 'receita' ? isReimbursement : false,
      notes,
      // Alerta só faz sentido com texto — nota vazia nunca fica no sininho.
      noteAlert: notes.trim() ? noteAlert : false,
      ...fxPatch(amountFx, currencyFx, signedAmount),
    };

    onSave(transaction.id, data);
    onClose();
  }

  /**
   * Satélites de moeda a gravar. Os três andam juntos: sem moeda declarada
   * ou sem valor, TODOS voltam a null — deixar `amountFx` órfão de
   * `currencyFx` produziria um número sem unidade, que nenhuma tela sabe
   * exibir. A taxa é derivada aqui (reais ÷ moeda) porque na entrada manual
   * não existe lote de câmbio de onde tirá-la; no caminho da importação ela
   * vem do FIFO e é bem mais precisa.
   */
  function fxPatch(rawFx: string, rawCurrency: string, signedBrl: number): Partial<Transaction> {
    const fx = parseMoneyInput(rawFx);
    const currency = rawCurrency.trim().toUpperCase();
    if (!fx || !currency) return { amountFx: null, currencyFx: null, fxRate: null };
    const magnitude = Math.abs(fx);
    return {
      amountFx: signedBrl < 0 ? -magnitude : magnitude,
      currencyFx: currency,
      fxRate: magnitude > 0 ? Math.abs(signedBrl) / magnitude : null,
    };
  }

  function handleDelete() {
    if (!onDelete) return;
    const ok = window.confirm('Tem certeza que deseja excluir este lançamento?');
    if (!ok) return;
    onDelete(transaction.id);
    onClose();
  }

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded-control text-text-primary text-body focus:outline-none focus:border-accent';
  const labelClass = 'block text-caption text-text-secondary mb-1 uppercase tracking-wider';

  return (
    // overlay-vv + max-h-full: o campo "Observações" fica no fim de um modal
    // rolável. Com `90vh` medido na janela inteira, no iPhone/iPad o fim do
    // modal — e o campo de nota — ficava atrás do teclado, e a caixa de rolagem
    // não tinha para onde rolar. Preso à faixa visível, o próprio navegador
    // traz o campo focado para dentro dela.
    <div
      className="fixed inset-0 overlay-vv bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-card w-full max-w-md max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg-card z-10">
          <h3 className="text-title font-semibold text-text-primary">Editar Lançamento</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('despesa')}
              className={`flex-1 py-1.5 text-body font-bold rounded-control ${type === 'despesa' ? 'bg-accent-red text-white' : 'bg-bg-secondary text-text-secondary'}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType('receita')}
              className={`flex-1 py-1.5 text-body font-bold rounded-control ${type === 'receita' ? 'bg-accent-green text-white' : 'bg-bg-secondary text-text-secondary'}`}
            >
              Receita
            </button>
          </div>

          {type === 'receita' && (
            <label className="flex items-start gap-2 px-3 py-2 bg-bg-secondary/50 border border-border rounded-control cursor-pointer">
              <input
                type="checkbox"
                checked={isReimbursement}
                onChange={(e) => setIsReimbursement(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span className="text-caption text-text-secondary leading-snug">
                <span className="font-semibold text-text-primary">É reembolso</span> — recuperação de um gasto (ex.: alguém te pagou de volta). Abate a despesa nos totais, em vez de contar como receita. Categorize com a categoria do gasto.
              </span>
            </label>
          )}

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

          {/* Moeda estrangeira: gasto em espécie ou em cartão internacional de
              outro banco, que nenhum importador conhece. O que vem do extrato
              da Wise já chega preenchido. O valor em R$ acima continua sendo
              o que conta nos totais — isto aqui só registra o original. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Valor em moeda estrangeira <span className="text-ink-3">(opcional)</span></label>
              <input
                type="text"
                inputMode="decimal"
                value={amountFx}
                onChange={(e) => setAmountFx(applyMoneyMask(e.target.value))}
                className={inputClass}
                placeholder="0,00"
              />
            </div>
            <div>
              <label className={labelClass}>Moeda</label>
              <input
                type="text"
                value={currencyFx}
                onChange={(e) => setCurrencyFx(e.target.value.toUpperCase().slice(0, 3))}
                className={inputClass}
                placeholder="EUR"
                maxLength={3}
              />
            </div>
          </div>
          {amountFx && currencyFx && (
            <p className="text-caption text-ink-3 -mt-1">
              Taxa deste lançamento: {fxRateLabel(amountFx, amount, currencyFx)}
            </p>
          )}

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
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noteAlert}
                onChange={(e) => setNoteAlert(e.target.checked)}
                style={{ accentColor: 'var(--color-accent-red)' }}
              />
              <span className={`text-caption flex items-center gap-1 ${noteAlert ? 'text-accent-red font-bold' : 'text-text-secondary'}`}>
                <AlertTriangle size={12} className={noteAlert ? 'text-accent-red' : 'text-text-secondary'} />
                Marcar nota como alerta (aparece no sininho)
              </span>
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 py-2 bg-accent text-bg-primary font-bold text-body rounded-control hover:opacity-90 flex items-center justify-center gap-2"
            >
              <Check size={16} />
              Salvar
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 border border-accent-red/40 text-accent-red text-body rounded-control hover:bg-accent-red/10 flex items-center gap-1.5"
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
