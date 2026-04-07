import { useState, useEffect } from 'react';
import { X, RefreshCw, Check, ChevronDown, AlertTriangle, Landmark, CreditCard, CheckSquare, Square } from 'lucide-react';
import type { Transaction, Account } from '../../types';
import { formatBRL } from '../../lib/utils';

// ─── Types from Pluggy API ───────────────────────────────────────────────────

interface PluggyItem {
  id: string;
  connector: { name: string; imageUrl: string | null };
  status: string;
  lastUpdatedAt: string | null;
}

interface PluggyAccount {
  id: string;
  itemId: string;
  name: string;
  number: string | null;
  balance: number;
  type: 'BANK' | 'CREDIT';
  subtype: string;
  owner: string | null;
}

interface PluggyTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: 'DEBIT' | 'CREDIT';
  status: 'POSTED' | 'PENDING';
  creditData: {
    purchaseDate: string | null;
    installmentNumber: number | null;
    totalInstallments: number | null;
  } | null;
  merchant: { name: string } | null;
}

// ─── Local types ─────────────────────────────────────────────────────────────

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;

interface PreviewRow extends ImportItem {
  isDuplicate: boolean;
  pluggyItemName: string;
  pluggyAccountName: string;
}

interface Props {
  existingTransactions: Transaction[];
  accounts: Account[];
  titularNames: string[];
  onImport: (items: ImportItem[]) => Promise<void>;
  onClose: () => void;
}

type Step = 'loading_items' | 'select_accounts' | 'fetching' | 'preview' | 'importing' | 'done';

// Date range options
const DATE_RANGES = [
  { label: 'Ultimos 30 dias', days: 30 },
  { label: 'Ultimos 60 dias', days: 60 },
  { label: 'Ultimos 90 dias', days: 90 },
  { label: 'Ultimos 6 meses', days: 180 },
  { label: 'Ultimo ano', days: 365 },
];

function isDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  // First check by Pluggy transaction ID (most reliable)
  if (item.pluggyTransactionId) {
    return existing.some((t) => t.pluggyTransactionId === item.pluggyTransactionId);
  }
  // Fallback: same date + amount + description
  return existing.some(
    (t) =>
      t.date.toDateString() === item.date.toDateString() &&
      Math.abs(t.amount - item.amount) < 0.01 &&
      t.description.toLowerCase() === item.description.toLowerCase()
  );
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

async function callProxy<T>(body: Record<string, unknown>): Promise<T> {
  const clientId = localStorage.getItem('pluggy_client_id') || '';
  const clientSecret = localStorage.getItem('pluggy_client_secret') || '';
  const res = await fetch('/api/pluggy-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, clientId, clientSecret }),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  }
  return data;
}

export function PluggySync({ existingTransactions, accounts, titularNames, onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>('loading_items');
  const [error, setError] = useState('');

  // Items + accounts from Pluggy
  const [items, setItems] = useState<PluggyItem[]>([]);
  const [pluggyAccounts, setPluggyAccounts] = useState<(PluggyAccount & { itemName: string })[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  // Date range
  const [rangeDays, setRangeDays] = useState(30);

  // Preview rows
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Account mapping: pluggyAccountId → local account name
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  // Titular mapping: pluggyAccountId → titular name
  const [titularMap, setTitularMap] = useState<Record<string, string>>({});

  const localAccountNames = accounts.map((a) => a.name);
  const inputClass = 'px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';

  // ─── Step 1: Load items ───────────────────────────────────────────────────

  useEffect(() => {
    loadItems();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadItems() {
    setStep('loading_items');
    setError('');
    try {
      const { items: fetchedItems } = await callProxy<{ items: PluggyItem[] }>({ action: 'items' });
      if (!fetchedItems || fetchedItems.length === 0) {
        setError('Nenhum banco conectado encontrado. Acesse meu.pluggy.ai e conecte suas contas bancarias primeiro.');
        return;
      }
      setItems(fetchedItems);

      // Fetch accounts for all items in parallel
      const accountsByItem = await Promise.all(
        fetchedItems.map((item) =>
          callProxy<{ accounts: PluggyAccount[] }>({ action: 'accounts', itemId: item.id })
            .then(({ accounts: accs }) => accs.map((a) => ({ ...a, itemName: item.connector.name })))
            .catch(() => [] as (PluggyAccount & { itemName: string })[])
        )
      );
      const allAccounts = accountsByItem.flat();
      setPluggyAccounts(allAccounts);

      // Pre-select all accounts
      setSelectedAccountIds(new Set(allAccounts.map((a) => a.id)));

      // Pre-populate account map: try to match by name
      const map: Record<string, string> = {};
      const titMap: Record<string, string> = {};
      for (const acc of allAccounts) {
        // Try to find a matching local account by name similarity
        const matched = localAccountNames.find((n) =>
          n.toLowerCase().includes(acc.itemName.toLowerCase().split(' ')[0]) ||
          acc.itemName.toLowerCase().includes(n.toLowerCase().split(' ')[0])
        );
        map[acc.id] = matched || localAccountNames[0] || '';
        titMap[acc.id] = titularNames[0] || '';
      }
      setAccountMap(map);
      setTitularMap(titMap);
      setStep('select_accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Step 2: Fetch transactions ───────────────────────────────────────────

  async function fetchTransactions() {
    if (selectedAccountIds.size === 0) return;
    setStep('fetching');
    setError('');

    const from = daysAgoISO(rangeDays);
    const to = todayISO();

    try {
      const selectedAccounts = pluggyAccounts.filter((a) => selectedAccountIds.has(a.id));
      const allRows: PreviewRow[] = [];

      for (const acc of selectedAccounts) {
        let page = 1;
        let totalPages = 1;
        const txns: PluggyTransaction[] = [];

        while (page <= totalPages) {
          const res = await callProxy<{
            transactions: PluggyTransaction[];
            total: number;
            page: number;
            totalPages: number;
          }>({ action: 'transactions', accountId: acc.id, from, to, page });

          txns.push(...res.transactions);
          totalPages = res.totalPages;
          page++;
          // Safety: cap at 5 pages (~2500 transactions) per account
          if (page > 5) break;
        }

        const localAccount = accountMap[acc.id] || localAccountNames[0] || '';
        const titular = titularMap[acc.id] || '';

        for (const tx of txns) {
          if (tx.status === 'PENDING') continue; // skip pending

          // Sign: DEBIT = expense (negative), CREDIT = income/refund (positive)
          // For credit cards this is already correct (purchase=DEBIT, payment=CREDIT)
          const amount = tx.type === 'DEBIT' ? -Math.abs(tx.amount) : Math.abs(tx.amount);

          const purchaseDate = tx.creditData?.purchaseDate
            ? new Date(tx.creditData.purchaseDate + 'T12:00:00')
            : null;

          const description = tx.merchant?.name || tx.description;

          const item: ImportItem = {
            date: new Date(tx.date + 'T12:00:00'),
            purchaseDate,
            description,
            amount,
            categoryId: null,
            account: localAccount,
            familyMember: titular,
            titular,
            installmentNumber: tx.creditData?.installmentNumber ?? null,
            totalInstallments: tx.creditData?.totalInstallments ?? null,
            cardNumber: acc.number?.slice(-4) ?? null,
            projectId: null,
            pluggyTransactionId: tx.id,
            tags: [],
            notes: '',
            importBatch: null,
            reconciled: false,
            reconciledAt: null,
          };

          allRows.push({
            ...item,
            isDuplicate: isDuplicate(item, existingTransactions),
            pluggyItemName: acc.itemName,
            pluggyAccountName: acc.name,
          });
        }
      }

      // Sort by date desc
      allRows.sort((a, b) => b.date.getTime() - a.date.getTime());
      setRows(allRows);

      // Pre-select non-duplicates
      const initialSelected = new Set(
        allRows.map((_, i) => i).filter((i) => !allRows[i].isDuplicate)
      );
      setSelected(initialSelected);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('select_accounts');
    }
  }

  // ─── Step 3: Import selected ──────────────────────────────────────────────

  async function handleImport() {
    const toImport = rows.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setStep('importing');
    try {
      await onImport(toImport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('preview');
    }
  }

  function toggleAll() {
    const nonDup = rows.map((_, i) => i).filter((i) => !rows[i].isDuplicate);
    if (nonDup.every((i) => selected.has(i))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(nonDup));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const selectedCount = selected.size;
  const dupCount = rows.filter((r) => r.isDuplicate).length;
  const newCount = rows.filter((r) => !r.isDuplicate).length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Landmark size={18} className="text-accent" />
            <div>
              <h2 className="text-sm font-bold text-text-primary">Sincronizar com Banco (Pluggy)</h2>
              {step === 'select_accounts' && (
                <p className="text-[10px] text-text-secondary">{items.length} banco(s) conectado(s) · {pluggyAccounts.length} conta(s)</p>
              )}
              {step === 'preview' && (
                <p className="text-[10px] text-text-secondary">{newCount} novas · {dupCount} duplicatas</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-accent-red/10 border border-accent-red/20 rounded text-xs text-accent-red">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading items */}
          {step === 'loading_items' && !error && (
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <RefreshCw size={16} className="animate-spin text-accent" />
              Buscando contas conectadas no Pluggy...
            </div>
          )}

          {/* Fetching transactions */}
          {step === 'fetching' && (
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <RefreshCw size={16} className="animate-spin text-accent" />
              Buscando transacoes... isso pode levar alguns segundos.
            </div>
          )}

          {/* Importing */}
          {step === 'importing' && (
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <RefreshCw size={16} className="animate-spin text-accent" />
              Importando {selectedCount} transacoes...
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center gap-3 py-8">
              <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center">
                <Check size={24} className="text-accent-green" />
              </div>
              <p className="text-sm font-bold text-text-primary">{selectedCount} transacoes importadas com sucesso!</p>
              <button onClick={onClose} className="mt-2 px-4 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
                Fechar
              </button>
            </div>
          )}

          {/* Select accounts + date range */}
          {step === 'select_accounts' && (
            <div className="space-y-5">
              {/* Date range */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-primary">Periodo</label>
                <div className="flex flex-wrap gap-2">
                  {DATE_RANGES.map((r) => (
                    <button
                      key={r.days}
                      onClick={() => setRangeDays(r.days)}
                      className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                        rangeDays === r.days
                          ? 'bg-accent text-bg-primary border-accent font-bold'
                          : 'border-border text-text-secondary hover:border-accent'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accounts list */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-primary">Contas para sincronizar</label>
                {pluggyAccounts.map((acc) => {
                  const checked = selectedAccountIds.has(acc.id);
                  return (
                    <div key={acc.id} className="border border-border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const next = new Set(selectedAccountIds);
                            if (checked) next.delete(acc.id);
                            else next.add(acc.id);
                            setSelectedAccountIds(next);
                          }}
                          className="text-accent"
                        >
                          {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-text-secondary" />}
                        </button>
                        {acc.type === 'CREDIT' ? (
                          <CreditCard size={14} className="text-accent shrink-0" />
                        ) : (
                          <Landmark size={14} className="text-accent shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold text-text-primary">{acc.itemName}</span>
                          <span className="text-[10px] text-text-secondary ml-2">{acc.name}</span>
                          {acc.number && <span className="text-[10px] text-text-secondary ml-1">*{acc.number.slice(-4)}</span>}
                        </div>
                        <span className="text-xs text-text-secondary shrink-0">{formatBRL(acc.balance)}</span>
                      </div>

                      {checked && (
                        <div className="flex gap-2 pl-6 flex-wrap">
                          <div className="flex-1 min-w-[140px] space-y-1">
                            <label className="text-[10px] text-text-secondary">Conta local</label>
                            <select
                              value={accountMap[acc.id] || ''}
                              onChange={(e) => setAccountMap((m) => ({ ...m, [acc.id]: e.target.value }))}
                              className={`${inputClass} w-full !py-1 !text-xs`}
                            >
                              <option value="">Nenhuma</option>
                              {localAccountNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                          <div className="flex-1 min-w-[140px] space-y-1">
                            <label className="text-[10px] text-text-secondary">Titular</label>
                            <select
                              value={titularMap[acc.id] || ''}
                              onChange={(e) => setTitularMap((m) => ({ ...m, [acc.id]: e.target.value }))}
                              className={`${inputClass} w-full !py-1 !text-xs`}
                            >
                              <option value="">Sem titular</option>
                              {titularNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview */}
          {step === 'preview' && (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 text-xs text-text-secondary">
                  <button onClick={toggleAll} className="flex items-center gap-1.5 text-accent hover:opacity-80">
                    {selected.size === newCount && newCount > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                    Selecionar novas ({newCount})
                  </button>
                  {dupCount > 0 && <span className="text-text-secondary">{dupCount} duplicatas ocultadas</span>}
                </div>
                <span className="text-xs font-bold text-text-primary">{selectedCount} selecionadas</span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-secondary border-b border-border">
                      <th className="text-left pb-2 w-6"></th>
                      <th className="text-left pb-2 w-20">Data</th>
                      <th className="text-left pb-2">Descricao</th>
                      <th className="text-left pb-2 hidden sm:table-cell">Conta/Banco</th>
                      <th className="text-right pb-2 w-24">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const isSelected = selected.has(i);
                      return (
                        <tr
                          key={i}
                          onClick={() => {
                            if (row.isDuplicate) return;
                            const next = new Set(selected);
                            if (isSelected) next.delete(i);
                            else next.add(i);
                            setSelected(next);
                          }}
                          className={`border-b border-border/40 transition-colors ${
                            row.isDuplicate
                              ? 'opacity-30 cursor-default'
                              : 'cursor-pointer hover:bg-bg-secondary'
                          }`}
                        >
                          <td className="py-1.5 pr-1">
                            {row.isDuplicate ? (
                              <span className="text-[9px] text-text-secondary">dup</span>
                            ) : isSelected ? (
                              <CheckSquare size={13} className="text-accent" />
                            ) : (
                              <Square size={13} className="text-text-secondary" />
                            )}
                          </td>
                          <td className="py-1.5 text-text-secondary whitespace-nowrap">
                            {row.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </td>
                          <td className="py-1.5 text-text-primary truncate max-w-[200px]">
                            <span title={row.description}>{row.description}</span>
                            {row.titular && (
                              <span className="ml-1 text-[10px] text-text-secondary">({row.titular})</span>
                            )}
                          </td>
                          <td className="py-1.5 text-text-secondary hidden sm:table-cell truncate max-w-[120px]">
                            {row.pluggyItemName}
                          </td>
                          <td className={`py-1.5 text-right font-mono whitespace-nowrap ${row.amount < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                            {formatBRL(row.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'select_accounts' || step === 'preview') && (
          <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3">
            {step === 'select_accounts' && (
              <>
                <span className="text-xs text-text-secondary">
                  {selectedAccountIds.size} conta(s) selecionada(s) · {DATE_RANGES.find((r) => r.days === rangeDays)?.label}
                </span>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-3 py-2 text-xs text-text-secondary hover:text-text-primary border border-border rounded">
                    Cancelar
                  </button>
                  <button
                    onClick={fetchTransactions}
                    disabled={selectedAccountIds.size === 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
                  >
                    <ChevronDown size={14} /> Buscar Transacoes
                  </button>
                </div>
              </>
            )}

            {step === 'preview' && (
              <>
                <button
                  onClick={() => setStep('select_accounts')}
                  className="px-3 py-2 text-xs text-text-secondary hover:text-text-primary border border-border rounded"
                >
                  Voltar
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedCount === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
                >
                  <Check size={14} /> Importar {selectedCount} transacoes
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
