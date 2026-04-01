import { useState } from 'react';
import { X, FileSpreadsheet, AlertTriangle, Check, Sparkles, CreditCard, ChevronDown } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import type { Transaction, Category, Account } from '../../types';
import { formatBRL, formatDate, getMonthYear, getMonthLabel, getMonthYearOffset } from '../../lib/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;
type ImportRow = ImportItem & {
  isDuplicate: boolean;
  installmentType: 'unica' | 'parcelada';
  periodicity: number; // months between installments
  installmentAmount: number | null;
};

function isDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  return existing.some(
    (t) =>
      t.date.toDateString() === item.date.toDateString() &&
      Math.abs(t.amount - item.amount) < 0.01 &&
      t.description.toLowerCase() === item.description.toLowerCase()
  );
}

interface Props {
  existingTransactions: Transaction[];
  onImport: (items: ImportItem[]) => Promise<void>;
  onClose: () => void;
  accountNames?: string[];
  accounts?: Account[];
  categories?: Category[];
  allTitulars?: string[];
  titularNames?: string[];
}

/** Fuzzy match a statement titular name to a registered member name */
function fuzzyMatchMember(statementName: string, memberNames: string[]): string {
  if (!statementName || memberNames.length === 0) return '';
  const normalized = statementName.toLowerCase().trim();

  // Exact match
  const exact = memberNames.find((n) => n.toLowerCase() === normalized);
  if (exact) return exact;

  // Statement name contains member name or vice versa
  for (const name of memberNames) {
    const nameLower = name.toLowerCase();
    if (normalized.includes(nameLower) || nameLower.includes(normalized)) return name;
  }

  // All parts of member name appear in statement name (handles abbreviations like "K" matching "Kuhn")
  for (const name of memberNames) {
    const parts = name.toLowerCase().split(/\s+/);
    const statementParts = normalized.split(/\s+/);
    const allMatch = parts.every((part) =>
      part.length === 1
        ? statementParts.some((w) => w.startsWith(part))
        : statementParts.some((w) => w.startsWith(part) || part.startsWith(w))
    );
    if (allMatch) return name;
  }

  // First name match (min 3 chars)
  for (const name of memberNames) {
    const firstName = name.toLowerCase().split(/\s+/)[0];
    const statementFirst = normalized.split(/\s+/)[0];
    if (firstName.length >= 3 && firstName === statementFirst) return name;
  }

  return '';
}

/** Generate month options: 6 months back + current + 3 months forward */
function generateMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let offset = -6; offset <= 3; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    options.push(getMonthYear(d));
  }
  return options;
}

export function ImportModal({ existingTransactions, onImport, onClose, accountNames = [], accounts = [], categories = [], allTitulars = [], titularNames = [] }: Props) {
  const [items, setItems] = useState<ImportRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiUsage, setAiUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);

  // Credit card billing month
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [billingMonth, setBillingMonth] = useState('');
  const monthOptions = generateMonthOptions();
  const creditCardAccounts = accounts.filter((a) => a.type === 'cartao');

  // Batch assignment controls
  const [batchAccount, setBatchAccount] = useState('');
  const [batchCategory, setBatchCategory] = useState('');
  const [batchMember, setBatchMember] = useState('');

  // Installment editor (position tracked for fixed popup outside overflow container)
  const [editingInstallment, setEditingInstallment] = useState<number | null>(null);
  const [installmentPopupPos, setInstallmentPopupPos] = useState<{ top: number; left: number } | null>(null);

  // Member options: only from titular mappings (registered members)
  const memberOptions = titularNames.length > 0 ? titularNames : allTitulars;

  // ─── Text extraction ────────────────────────────────────────────────────────

  async function extractRawText(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      const text = await file.text();
      console.log('[CSV extract] chars:', text.length, '| preview:', text.slice(0, 300));
      return text;
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      let text = '';
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        text += csv + '\n';
      }
      console.log('[Excel extract] chars:', text.length, '| preview:', text.slice(0, 300));
      return text;
    }

    if (ext === 'pdf') {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lineMap = new Map<number, { x: number; text: string }[]>();
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] / 3) * 3;
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.transform[4], text: item.str });
        }
        const lines = Array.from(lineMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.text).join(' '));
        text += lines.join('\n') + '\n\n';
      }
      if (text.trim().length < 100) {
        text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          text += content.items.filter((i) => 'str' in i).map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
        }
      }
      console.log('[PDF extract] chars:', text.length, '| preview:', text.slice(0, 300));
      return text;
    }

    throw new Error('Formato nao suportado. Use .xlsx, .xls, .csv ou .pdf');
  }

  // ─── Parse via AI ───────────────────────────────────────────────────────────

  async function handleParse(file: File) {
    setError('');
    setFileName(file.name);
    setAiParsing(true);

    try {
      const rawText = await extractRawText(file);

      if (rawText.trim().length < 50) {
        setError('Nao foi possivel extrair dados do arquivo. Se for PDF escaneado, use Excel/CSV.');
        setAiParsing(false);
        return;
      }

      const response = await fetch('/api/parse-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, fileName: file.name }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro de conexao' }));
        const errData = err as { error?: string; raw?: string };
        if (errData.raw) console.log('[API raw response]', errData.raw);
        throw new Error(errData.error || `Erro ${response.status}`);
      }

      const data = await response.json() as {
        transactions: Array<{
          date: string; purchaseDate: string | null; description: string;
          amount: number; titular: string;
          installmentNumber: number | null; totalInstallments: number | null; cardNumber: string | null;
        }>;
        isCreditCard?: boolean;
        usage: { input_tokens: number; output_tokens: number };
      };

      setAiUsage(data.usage);

      // Detect credit card: AI flag or heuristic (most transactions have cardNumber)
      const hasCardNumbers = data.transactions.filter((t) => t.cardNumber).length > data.transactions.length / 2;
      const detectedCreditCard = !!data.isCreditCard || hasCardNumbers;
      setIsCreditCard(detectedCreditCard);

      const parsed: ImportRow[] = data.transactions.map((t) => {
        const date = new Date(t.date + 'T12:00:00');
        const matchedMember = fuzzyMatchMember(t.titular || '', memberOptions);
        const hasInstallments = t.totalInstallments != null && t.totalInstallments > 1;
        const item: ImportItem = {
          date,
          purchaseDate: t.purchaseDate ? new Date(t.purchaseDate + 'T12:00:00') : null,
          description: t.description,
          amount: t.amount,
          categoryId: null,
          account: accountNames[0] ?? '',
          familyMember: matchedMember,
          titular: t.titular || '',
          installmentNumber: t.installmentNumber,
          totalInstallments: t.totalInstallments,
          cardNumber: t.cardNumber,
          pluggyTransactionId: null,
          tags: [],
          notes: '',
          importBatch: null,
        };
        return {
          ...item,
          isDuplicate: isDuplicate(item, existingTransactions),
          installmentType: hasInstallments ? 'parcelada' as const : 'unica' as const,
          periodicity: 1,
          installmentAmount: hasInstallments ? t.amount : null,
        };
      });

      if (parsed.length === 0) {
        setError(`A IA nao encontrou transacoes no arquivo (${rawText.length} chars extraidos). Verifique o DevTools > Console para ver o texto extraido.`);
        setAiParsing(false);
        return;
      }

      // Auto-detect billing month from most common month in transaction dates
      if (detectedCreditCard && parsed.length > 0) {
        const monthCounts = new Map<string, number>();
        for (const p of parsed) {
          const my = getMonthYear(p.date);
          monthCounts.set(my, (monthCounts.get(my) || 0) + 1);
        }
        const detectedMonth = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        setBillingMonth(detectedMonth);

        // Auto-select credit card account if only one exists
        if (creditCardAccounts.length === 1) {
          const ccName = creditCardAccounts[0].name;
          parsed.forEach((p) => { p.account = ccName; });
        }
      }

      setItems(parsed);
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].isDuplicate)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo');
    }
    setAiParsing(false);
  }

  // ─── Batch apply ────────────────────────────────────────────────────────────

  function applyBatch() {
    setItems((prev) => prev.map((item, i) => {
      if (!selected.has(i)) return item;
      return {
        ...item,
        ...(batchAccount ? { account: batchAccount } : {}),
        ...(batchCategory ? { categoryId: batchCategory } : {}),
        ...(batchMember ? { familyMember: batchMember } : {}),
      };
    }));
    setBatchAccount(''); setBatchCategory(''); setBatchMember('');
  }

  function updateRow(index: number, field: keyof ImportItem, value: string) {
    // Keep string fields as empty string, only use null for ID fields like categoryId
    const nullableFields: (keyof ImportItem)[] = ['categoryId'];
    const finalValue = nullableFields.includes(field) ? (value || null) : value;
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: finalValue } : item));
  }

  function updateInstallmentConfig(index: number, updates: Partial<ImportRow>) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleParse(file);
  }

  function toggleItem(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((_, i) => i)));
  }

  async function handleImport() {
    setImporting(true);
    const toImport: ImportItem[] = [];

    // Billing month date (for credit card invoice assignment)
    let billingDate: Date | null = null;
    if (isCreditCard && billingMonth) {
      const [year, month] = billingMonth.split('-').map(Number);
      billingDate = new Date(year, month - 1, 1, 12, 0, 0);
    }

    for (const [i, row] of items.entries()) {
      if (!selected.has(i)) continue;
      const { isDuplicate: _, installmentType, periodicity, installmentAmount, ...rest } = row;

      // Original date is purchase date; billing date is for invoice assignment
      const purchaseDate = rest.purchaseDate || rest.date;
      const invoiceDate = billingDate || rest.date;

      if (installmentType === 'parcelada' && rest.totalInstallments && rest.totalInstallments > 1) {
        const amount = installmentAmount ?? rest.amount;
        const currentInst = rest.installmentNumber || 1;
        const remaining = rest.totalInstallments - currentInst;

        // Current installment (the one in this invoice)
        toImport.push({
          ...rest,
          date: invoiceDate,
          purchaseDate,
          amount,
          installmentNumber: currentInst,
          totalInstallments: rest.totalInstallments,
        });

        // Future installments
        for (let offset = 1; offset <= remaining; offset++) {
          const futureDate = new Date(invoiceDate);
          futureDate.setMonth(futureDate.getMonth() + offset * (periodicity || 1));
          toImport.push({
            ...rest,
            date: futureDate,
            purchaseDate,
            amount,
            installmentNumber: currentInst + offset,
            totalInstallments: rest.totalInstallments,
          });
        }
      } else {
        toImport.push({ ...rest, date: invoiceDate, purchaseDate });
      }
    }

    await onImport(toImport);
    setStep('done');
    setImporting(false);
  }

  const duplicateCount = items.filter((i) => i.isDuplicate).length;

  // Category helper for select options
  const rootCats = categories.filter((c) => !c.parentId);
  const subCats = (pid: string) => categories.filter((c) => c.parentId === pid);

  const inputClass = 'w-full px-2 py-1 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">Importar Extrato</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">

          {/* UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-4">
              {aiParsing ? (
                <div className="border-2 border-dashed border-accent rounded-lg p-12 text-center">
                  <Sparkles size={32} className="mx-auto mb-3 text-accent animate-pulse" />
                  <p className="text-sm text-text-primary mb-1">Analisando extrato com IA...</p>
                  <p className="text-xs text-text-secondary">Isso pode levar alguns segundos</p>
                </div>
              ) : (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-accent/50 rounded-lg p-12 text-center hover:border-accent transition-colors cursor-pointer bg-accent/5"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.xlsx,.xls,.csv,.pdf';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleParse(file);
                    };
                    input.click();
                  }}
                >
                  <Sparkles size={32} className="mx-auto mb-3 text-accent" />
                  <p className="text-sm font-bold text-text-primary mb-1">Arrastar arquivo ou clicar</p>
                  <p className="text-xs text-text-secondary mb-3">A IA detecta transacoes, parcelas, titulares e categorias</p>
                  <p className="text-[10px] text-text-secondary">.xlsx .xls .csv .pdf</p>
                </div>
              )}
              {error && <p className="text-accent-red text-xs mt-3">{error}</p>}
            </div>
          )}

          {/* PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-3">

              {/* Summary bar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-accent" />
                  <span className="text-xs text-text-primary font-bold">{fileName}</span>
                  <span className="text-xs text-text-secondary">— {items.length} transacoes encontradas</span>
                  {duplicateCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-amber-400">
                      <AlertTriangle size={12} /> {duplicateCount} possiveis duplicatas
                    </span>
                  )}
                </div>
                {aiUsage && (
                  <span className="text-[10px] text-text-secondary flex items-center gap-1">
                    <Sparkles size={10} /> IA ({aiUsage.input_tokens + aiUsage.output_tokens} tokens)
                  </span>
                )}
              </div>

              {/* Credit card billing month */}
              {isCreditCard && (
                <div className="bg-accent/5 border border-accent/30 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CreditCard size={16} className="text-accent" />
                    <span className="text-xs font-bold text-text-primary">Fatura de cartao detectada</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-secondary whitespace-nowrap">Lancar na fatura de:</label>
                    <select
                      value={billingMonth}
                      onChange={(e) => setBillingMonth(e.target.value)}
                      className={inputClass + ' !w-auto'}
                    >
                      {monthOptions.map((m) => (
                        <option key={m} value={m}>{getMonthLabel(m)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Batch controls */}
              <div className="bg-bg-secondary border border-border rounded-lg p-3">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Aplicar em lote nas selecionadas</p>
                <div className="flex gap-2 flex-wrap items-end">
                  {accountNames.length > 0 && (
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-[10px] text-text-secondary mb-1">Conta</p>
                      <select value={batchAccount} onChange={(e) => setBatchAccount(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {accountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}
                  {categories.length > 0 && (
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-[10px] text-text-secondary mb-1">Categoria</p>
                      <select value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {rootCats.map((cat) => {
                          const subs = subCats(cat.id);
                          return (
                            <optgroup key={cat.id} label={`${cat.icon} ${cat.name}`}>
                              <option value={cat.id}>{cat.icon} {cat.name}</option>
                              {subs.map((s) => <option key={s.id} value={s.id}>  ↳ {s.icon} {s.name}</option>)}
                            </optgroup>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  {memberOptions.length > 0 && (
                    <div className="flex-1 min-w-[120px]">
                      <p className="text-[10px] text-text-secondary mb-1">Membro</p>
                      <select value={batchMember} onChange={(e) => setBatchMember(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {memberOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={applyBatch}
                    disabled={!batchAccount && !batchCategory && !batchMember}
                    className="px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
                  >
                    <Check size={12} /> Aplicar
                  </button>
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-auto max-h-[45vh] border border-border rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-card z-10">
                    <tr className="border-b border-border text-text-secondary">
                      <th className="p-2 text-left w-8">
                        <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="accent-accent" />
                      </th>
                      <th className="p-2 text-left whitespace-nowrap">Data</th>
                      <th className="p-2 text-left">Descricao</th>
                      <th className="p-2 text-right whitespace-nowrap">Valor</th>
                      <th className="p-2 text-center whitespace-nowrap">Parc.</th>
                      <th className="p-2 text-left whitespace-nowrap">Compra em</th>
                      <th className="p-2 text-left min-w-[110px]">Conta</th>
                      <th className="p-2 text-left min-w-[120px]">Categoria</th>
                      <th className="p-2 text-left min-w-[100px]">Membro</th>
                      <th className="p-2 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr
                        key={i}
                        className={`border-b border-border/40 ${item.isDuplicate ? 'bg-amber-500/5' : ''} ${selected.has(i) ? '' : 'opacity-40'}`}
                      >
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggleItem(i)} className="accent-accent" />
                        </td>
                        <td className="p-2 text-text-secondary whitespace-nowrap">{formatDate(item.date)}</td>
                        <td className="p-2 text-text-primary max-w-[180px] truncate" title={item.description}>{item.description}</td>
                        <td className={`p-2 text-right font-bold whitespace-nowrap ${item.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {formatBRL(item.amount)}
                        </td>
                        <td className="p-1 text-center">
                          <button
                            onClick={(e) => {
                              if (editingInstallment === i) {
                                setEditingInstallment(null);
                                setInstallmentPopupPos(null);
                              } else {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setInstallmentPopupPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 - 110 });
                                setEditingInstallment(i);
                              }
                            }}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              item.installmentType === 'parcelada'
                                ? 'bg-accent/10 border-accent/30 text-accent'
                                : 'bg-bg-secondary border-border text-text-secondary hover:border-accent/30'
                            }`}
                          >
                            {item.installmentType === 'parcelada'
                              ? `${item.installmentNumber || 1}/${item.totalInstallments}`
                              : 'Unica'}
                            <ChevronDown size={10} className="inline ml-1" />
                          </button>
                        </td>
                        <td className="p-2 text-text-secondary whitespace-nowrap">
                          {item.purchaseDate ? formatDate(item.purchaseDate) : '—'}
                        </td>
                        {/* Editable: account */}
                        <td className="p-1">
                          {accountNames.length > 0 ? (
                            <select
                              value={item.account}
                              onChange={(e) => updateRow(i, 'account', e.target.value)}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {accountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          ) : (
                            <span className="text-text-secondary">{item.account || '—'}</span>
                          )}
                        </td>
                        {/* Editable: category */}
                        <td className="p-1">
                          {categories.length > 0 ? (
                            <select
                              value={item.categoryId ?? ''}
                              onChange={(e) => updateRow(i, 'categoryId', e.target.value)}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {rootCats.map((cat) => {
                                const subs = subCats(cat.id);
                                return (
                                  <optgroup key={cat.id} label={`${cat.icon} ${cat.name}`}>
                                    <option value={cat.id}>{cat.icon} {cat.name}</option>
                                    {subs.map((s) => <option key={s.id} value={s.id}>  ↳ {s.name}</option>)}
                                  </optgroup>
                                );
                              })}
                            </select>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                        {/* Editable: family member */}
                        <td className="p-1">
                          {memberOptions.length > 0 ? (
                            <select
                              value={item.familyMember}
                              onChange={(e) => updateRow(i, 'familyMember', e.target.value)}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {memberOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <span className="text-text-secondary">{item.familyMember || '—'}</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {item.isDuplicate && (
                            <span title="Possivel duplicata — ja existe transacao com mesma data, valor e descricao">
                              <AlertTriangle size={13} className="text-amber-400" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Installment popup — rendered outside table overflow container */}
              {editingInstallment !== null && installmentPopupPos && items[editingInstallment] && (() => {
                const item = items[editingInstallment];
                const idx = editingInstallment;
                return (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => { setEditingInstallment(null); setInstallmentPopupPos(null); }} />
                    <div
                      className="fixed z-50 bg-bg-card border border-border rounded-lg shadow-lg p-3 w-[240px]"
                      style={{ top: installmentPopupPos.top, left: installmentPopupPos.left }}
                    >
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Tipo de parcela</p>
                      <div className="flex gap-2 mb-3">
                        <button
                          onClick={() => updateInstallmentConfig(idx, {
                            installmentType: 'unica',
                            installmentNumber: null,
                            totalInstallments: null,
                            installmentAmount: null,
                          })}
                          className={`flex-1 px-2 py-1 rounded text-xs border ${
                            item.installmentType === 'unica'
                              ? 'bg-accent text-bg-primary border-accent'
                              : 'bg-bg-secondary text-text-secondary border-border'
                          }`}
                        >
                          Unica
                        </button>
                        <button
                          onClick={() => updateInstallmentConfig(idx, {
                            installmentType: 'parcelada',
                            installmentNumber: item.installmentNumber || 1,
                            totalInstallments: item.totalInstallments || 2,
                            installmentAmount: item.installmentAmount ?? item.amount,
                            periodicity: item.periodicity || 1,
                          })}
                          className={`flex-1 px-2 py-1 rounded text-xs border ${
                            item.installmentType === 'parcelada'
                              ? 'bg-accent text-bg-primary border-accent'
                              : 'bg-bg-secondary text-text-secondary border-border'
                          }`}
                        >
                          Parcelada
                        </button>
                      </div>
                      {item.installmentType === 'parcelada' && (() => {
                        const currentInst = item.installmentNumber || 1;
                        const totalInst = item.totalInstallments || 2;
                        const remaining = totalInst - currentInst;
                        return (
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-text-secondary">Periodicidade</label>
                              <select
                                value={item.periodicity}
                                onChange={(e) => updateInstallmentConfig(idx, { periodicity: Number(e.target.value) })}
                                className={inputClass}
                              >
                                <option value={1}>Mensal</option>
                                <option value={2}>Bimestral</option>
                                <option value={3}>Trimestral</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-text-secondary">Numero total de parcelas</label>
                              <input
                                type="number"
                                min={2}
                                max={48}
                                value={totalInst}
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 2;
                                  updateInstallmentConfig(idx, {
                                    totalInstallments: val,
                                    installmentNumber: Math.min(currentInst, val),
                                  });
                                }}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-text-secondary">Parcela atual</label>
                              <input
                                type="number"
                                min={1}
                                max={totalInst}
                                value={currentInst}
                                onChange={(e) => updateInstallmentConfig(idx, { installmentNumber: Number(e.target.value) || 1 })}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-text-secondary">Valor da parcela</label>
                              <input
                                type="number"
                                step="0.01"
                                value={Math.abs(item.installmentAmount ?? item.amount)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  updateInstallmentConfig(idx, { installmentAmount: item.amount < 0 ? -val : val });
                                }}
                                className={inputClass}
                              />
                            </div>
                            <div className="text-[10px] text-text-secondary mt-1 space-y-0.5">
                              <p>Parcela {currentInst}/{totalInst} — {remaining > 0 ? `${remaining} parcelas futuras serao criadas` : 'ultima parcela'}</p>
                              <p>Total: {formatBRL((item.installmentAmount ?? item.amount) * totalInst)}</p>
                            </div>
                          </div>
                        );
                      })()}
                      <button
                        onClick={() => { setEditingInstallment(null); setInstallmentPopupPos(null); }}
                        className="mt-2 w-full px-2 py-1 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
                      >
                        OK
                      </button>
                    </div>
                  </>
                );
              })()}

              {error && <p className="text-accent-red text-xs">{error}</p>}
            </div>
          )}

          {/* DONE */}
          {step === 'done' && (
            <div className="text-center py-8">
              <Check size={32} className="mx-auto mb-3 text-accent-green" />
              <p className="text-sm text-text-primary">Importacao concluida!</p>
              <p className="text-xs text-text-secondary mt-1">{selected.size} transacoes importadas</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-secondary">{selected.size} de {items.length} selecionadas</span>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('upload'); setItems([]); setError(''); setAiUsage(null); }}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                Voltar
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
                className="px-4 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
              >
                {importing ? 'Importando...' : `Importar ${selected.size} transacoes`}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="p-4 border-t border-border flex justify-end">
            <button onClick={onClose} className="px-4 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
