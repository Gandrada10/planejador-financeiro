import { useState, useCallback } from 'react';
import { X, Upload, FileSpreadsheet, AlertTriangle, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { Transaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;

interface Props {
  existingTransactions: Transaction[];
  onImport: (items: ImportItem[]) => Promise<void>;
  onClose: () => void;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + value);
    return epoch;
  }
  const str = String(value).trim();
  // DD/MM/YYYY
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (brMatch) {
    const year = brMatch[3].length === 2 ? 2000 + parseInt(brMatch[3]) : parseInt(brMatch[3]);
    return new Date(year, parseInt(brMatch[2]) - 1, parseInt(brMatch[1]), 12);
  }
  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]), 12);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const str = String(value).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(str) || 0;
}

function detectColumns(headers: string[]): { dateCol: number; descCol: number; amountCol: number } {
  const lower = headers.map((h) => (h || '').toString().toLowerCase().trim());

  const datePatterns = ['data', 'date', 'dt', 'dia'];
  const descPatterns = ['descri', 'historico', 'lancamento', 'memo', 'detail', 'description'];
  const amountPatterns = ['valor', 'value', 'amount', 'quantia', 'vl'];

  const find = (patterns: string[]) => lower.findIndex((h) => patterns.some((p) => h.includes(p)));

  let dateCol = find(datePatterns);
  let descCol = find(descPatterns);
  let amountCol = find(amountPatterns);

  // Fallback: first 3 columns
  if (dateCol === -1) dateCol = 0;
  if (descCol === -1) descCol = dateCol === 0 ? 1 : 0;
  if (amountCol === -1) amountCol = Math.max(dateCol, descCol) + 1;

  return { dateCol, descCol, amountCol };
}

function isDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  return existing.some(
    (t) =>
      t.date.toDateString() === item.date.toDateString() &&
      Math.abs(t.amount - item.amount) < 0.01 &&
      t.description.toLowerCase() === item.description.toLowerCase()
  );
}

export function ImportModal({ existingTransactions, onImport, onClose }: Props) {
  const [items, setItems] = useState<(ImportItem & { isDuplicate: boolean })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  const processRows = useCallback(
    (rows: unknown[][], headers: string[]) => {
      const { dateCol, descCol, amountCol } = detectColumns(headers);
      const parsed: (ImportItem & { isDuplicate: boolean })[] = [];

      for (const row of rows) {
        const date = parseDate(row[dateCol]);
        const description = String(row[descCol] || '').trim();
        const amount = parseAmount(row[amountCol]);

        if (!date || !description || amount === 0) continue;

        const item: ImportItem = {
          date,
          description,
          amount,
          categoryId: null,
          account: '',
          familyMember: '',
          tags: [],
          notes: '',
          importBatch: null,
        };

        parsed.push({ ...item, isDuplicate: isDuplicate(item, existingTransactions) });
      }

      if (parsed.length === 0) {
        setError('Nenhuma transacao encontrada no arquivo. Verifique o formato.');
        return;
      }

      setItems(parsed);
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].isDuplicate)));
      setStep('preview');
    },
    [existingTransactions]
  );

  function handleFile(file: File) {
    setError('');
    setFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      Papa.parse(file, {
        complete: (result) => {
          const rows = result.data as unknown[][];
          if (rows.length < 2) {
            setError('Arquivo vazio ou invalido');
            return;
          }
          processRows(rows.slice(1), rows[0] as string[]);
        },
        error: () => setError('Erro ao ler CSV'),
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
        if (rows.length < 2) {
          setError('Planilha vazia');
          return;
        }
        processRows(rows.slice(1), rows[0] as string[]);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError('Formato nao suportado. Use .xlsx, .xls ou .csv');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function toggleItem(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((_, i) => i)));
    }
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
          {step === 'upload' && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-accent transition-colors cursor-pointer"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.xlsx,.xls,.csv';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
            >
              <Upload size={32} className="mx-auto mb-3 text-text-secondary" />
              <p className="text-sm text-text-primary mb-1">Arraste seu extrato aqui</p>
              <p className="text-xs text-text-secondary">.xlsx .xls .csv</p>
            </div>
          )}

          {error && (
            <p className="text-accent-red text-xs mt-3">{error}</p>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-accent" />
                  <span className="text-xs text-text-primary">{fileName}</span>
                  <span className="text-xs text-text-secondary">— {items.length} transacoes</span>
                </div>
                {duplicateCount > 0 && (
                  <div className="flex items-center gap-1 text-xs text-accent">
                    <AlertTriangle size={14} />
                    {duplicateCount} possiveis duplicatas
                  </div>
                )}
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
                      <th className="p-2 text-right">Valor</th>
                      <th className="p-2 text-center w-12">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr
                        key={i}
                        className={`border-b border-border/50 ${item.isDuplicate ? 'opacity-50' : ''} ${selected.has(i) ? '' : 'opacity-40'}`}
                      >
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggleItem(i)} className="accent-accent" />
                        </td>
                        <td className="p-2 text-text-secondary">{formatDate(item.date)}</td>
                        <td className="p-2 text-text-primary truncate max-w-[200px]">{item.description}</td>
                        <td className={`p-2 text-right font-bold ${item.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {formatBRL(item.amount)}
                        </td>
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
              <button onClick={() => { setStep('upload'); setItems([]); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
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
