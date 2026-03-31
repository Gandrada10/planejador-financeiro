import { useState } from 'react';
import { X, FileSpreadsheet, AlertTriangle, Check, Sparkles } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Transaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';

// PDF.js worker bundled by Vite (avoids CDN dependency)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;

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
}

export function ImportModal({ existingTransactions, onImport, onClose }: Props) {
  const [items, setItems] = useState<(ImportItem & { isDuplicate: boolean })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiUsage, setAiUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);

  async function extractRawText(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'pdf') {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lineMap = new Map<number, { x: number; text: string }[]>();
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = Math.round(item.transform[5]);
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.transform[4], text: item.str });
        }
        const lines = Array.from(lineMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.text).join('  '));
        text += lines.join('\n') + '\n';
      }
      return text;
    }
    throw new Error('Formato nao suportado. Use .xlsx, .xls, .csv ou .pdf');
  }

  async function handleParse(file: File) {
    setError('');
    setFileName(file.name);
    setAiParsing(true);

    try {
      const rawText = await extractRawText(file);
      const response = await fetch('/api/parse-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, fileName: file.name }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro de conexao' }));
        throw new Error((err as { error?: string }).error || `Erro ${response.status}`);
      }

      const data = await response.json() as {
        transactions: Array<{
          date: string;
          purchaseDate: string | null;
          description: string;
          amount: number;
          titular: string;
          installmentNumber: number | null;
          totalInstallments: number | null;
          cardNumber: string | null;
        }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      setAiUsage(data.usage);

      const parsed: (ImportItem & { isDuplicate: boolean })[] = data.transactions.map((t) => {
        const date = new Date(t.date + 'T12:00:00');
        const item: ImportItem = {
          date,
          purchaseDate: t.purchaseDate ? new Date(t.purchaseDate + 'T12:00:00') : null,
          description: t.description,
          amount: t.amount,
          categoryId: null,
          account: '',
          familyMember: '',
          titular: t.titular || '',
          installmentNumber: t.installmentNumber,
          totalInstallments: t.totalInstallments,
          cardNumber: t.cardNumber,
          pluggyTransactionId: null,
          tags: [],
          notes: '',
          importBatch: null,
        };
        return { ...item, isDuplicate: isDuplicate(item, existingTransactions) };
      });

      if (parsed.length === 0) {
        setError('A IA nao encontrou transacoes no arquivo. Verifique se o arquivo contem dados validos.');
        setAiParsing(false);
        return;
      }

      setItems(parsed);
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].isDuplicate)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo');
    }
    setAiParsing(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleParse(file);
  }

  function toggleItem(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((_, i) => i)));
  }

  async function handleImport() {
    setImporting(true);
    const toImport = items.filter((_, i) => selected.has(i)).map(({ isDuplicate: _, ...rest }) => rest);
    await onImport(toImport);
    setStep('done');
    setImporting(false);
  }

  const duplicateCount = items.filter((i) => i.isDuplicate).length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">Importar Extrato</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
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
                <>
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
                    <p className="text-xs text-text-secondary mb-3">A IA le qualquer formato e detecta parcelas, titulares e categorias</p>
                    <p className="text-[10px] text-text-secondary">.xlsx .xls .csv .pdf</p>
                  </div>
                </>
              )}
            </div>
          )}

          {error && <p className="text-accent-red text-xs mt-3">{error}</p>}

          {/* PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-accent" />
                  <span className="text-xs text-text-primary">{fileName}</span>
                  <span className="text-xs text-text-secondary">— {items.length} transacoes</span>
                </div>
                <div className="flex items-center gap-2">
                  {aiUsage && (
                    <span className="text-[10px] text-text-secondary flex items-center gap-1">
                      <Sparkles size={10} /> IA ({aiUsage.input_tokens + aiUsage.output_tokens} tokens)
                    </span>
                  )}
                  {duplicateCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-accent">
                      <AlertTriangle size={14} />
                      {duplicateCount} duplicatas
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-auto max-h-[50vh]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-text-secondary">
                      <th className="p-2 text-left w-8">
                        <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll} className="accent-accent" />
                      </th>
                      <th className="p-2 text-left">Data</th>
                      <th className="p-2 text-left">Descricao</th>
                      {aiUsage && <th className="p-2 text-left">Titular</th>}
                      <th className="p-2 text-right">Valor</th>
                      {aiUsage && <th className="p-2 text-center">Parc.</th>}
                      {aiUsage && <th className="p-2 text-left">Compra em</th>}
                      <th className="p-2 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i} className={`border-b border-border/50 ${item.isDuplicate ? 'opacity-50' : ''} ${selected.has(i) ? '' : 'opacity-40'}`}>
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggleItem(i)} className="accent-accent" />
                        </td>
                        <td className="p-2 text-text-secondary">{formatDate(item.date)}</td>
                        <td className="p-2 text-text-primary truncate max-w-[200px]">{item.description}</td>
                        {aiUsage && <td className="p-2 text-text-secondary text-xs">{item.titular || '—'}</td>}
                        <td className={`p-2 text-right font-bold ${item.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {formatBRL(item.amount)}
                        </td>
                        {aiUsage && (
                          <td className="p-2 text-center text-text-secondary text-[10px]">
                            {item.totalInstallments ? `${item.installmentNumber}/${item.totalInstallments}` : '—'}
                          </td>
                        )}
                        {aiUsage && (
                          <td className="p-2 text-text-secondary text-[10px]">
                            {item.purchaseDate ? formatDate(item.purchaseDate) : '—'}
                          </td>
                        )}
                        <td className="p-2 text-center">
                          {item.isDuplicate && <span title="Possivel duplicata"><AlertTriangle size={14} className="text-accent inline" /></span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

        {step === 'preview' && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-secondary">{selected.size} de {items.length} selecionadas</span>
            <div className="flex gap-2">
              <button onClick={() => { setStep('upload'); setItems([]); setError(''); setAiUsage(null); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
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
