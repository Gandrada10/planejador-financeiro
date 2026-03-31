import { useState, useCallback } from 'react';
import { X, Upload, FileSpreadsheet, AlertTriangle, Check, Settings2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import type { Transaction } from '../../types';
import { formatBRL, formatDate } from '../../lib/utils';

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;

interface Props {
  existingTransactions: Transaction[];
  onImport: (items: ImportItem[]) => Promise<void>;
  onClose: () => void;
}

interface ColumnMapping {
  dateCol: number;
  descCol: number;
  amountCol: number;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + value);
    return epoch;
  }
  const str = String(value).trim();
  // DD/MM/YYYY or DD/MM/YY
  const brMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (brMatch) {
    const year = brMatch[3].length === 2 ? 2000 + parseInt(brMatch[3]) : parseInt(brMatch[3]);
    return new Date(year, parseInt(brMatch[2]) - 1, parseInt(brMatch[1]), 12);
  }
  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]), 12);
  }
  return null;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  let str = String(value).trim();
  // Remove R$, spaces
  str = str.replace(/[R$\s]/g, '');
  // Handle Brazilian format: 1.234,56 -> 1234.56
  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  // Handle negative with parentheses: (100) or with D/C suffix
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.slice(1, -1);
  }
  if (str.endsWith('D') || str.endsWith('d')) {
    str = '-' + str.slice(0, -1).trim();
  }
  if (str.endsWith('C') || str.endsWith('c')) {
    str = str.slice(0, -1).trim();
  }
  return parseFloat(str) || 0;
}

function looksLikeDate(value: unknown): boolean {
  return parseDate(value) !== null;
}

function looksLikeAmount(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (!value) return false;
  const str = String(value).trim();
  return /^[\(\-]?[R$\s]*[\d.,]+[DC)]*$/i.test(str) && parseAmount(str) !== 0;
}

// Scan all rows to find the header row (the row before data starts)
function findHeaderAndData(allRows: unknown[][]): { headerRow: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(allRows.length - 1, 30); i++) {
    const row = allRows[i];
    if (!row || row.length < 2) continue;

    // Check if NEXT rows look like data (have dates and amounts)
    let dataRowsFound = 0;
    for (let j = i + 1; j < Math.min(i + 5, allRows.length); j++) {
      const nextRow = allRows[j];
      if (!nextRow || nextRow.length < 2) continue;
      const hasDate = nextRow.some((cell) => looksLikeDate(cell));
      const hasAmount = nextRow.some((cell) => looksLikeAmount(cell));
      if (hasDate && hasAmount) dataRowsFound++;
    }

    if (dataRowsFound >= 2) {
      return {
        headerRow: i,
        headers: row.map((cell) => String(cell || '').trim()),
      };
    }
  }
  return null;
}

function detectColumns(headers: string[], dataRows: unknown[][]): ColumnMapping | null {
  const lower = headers.map((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

  const datePatterns = ['data', 'date', 'dt', 'dia', 'vencimento', 'competencia'];
  const descPatterns = ['descri', 'historico', 'lancamento', 'lanc', 'memo', 'detail', 'description', 'extrato', 'movimentacao'];
  const amountPatterns = ['valor', 'value', 'amount', 'quantia', 'vl', 'montante', 'debito', 'credito'];

  const find = (patterns: string[]) => lower.findIndex((h) => patterns.some((p) => h.includes(p)));

  let dateCol = find(datePatterns);
  let descCol = find(descPatterns);
  let amountCol = find(amountPatterns);

  // If pattern matching failed, detect by data content
  if (dateCol === -1 || descCol === -1 || amountCol === -1) {
    const sampleRows = dataRows.slice(0, 10);
    const colScores: { date: number; desc: number; amount: number }[] = [];

    const numCols = Math.max(...sampleRows.map((r) => r.length), headers.length);
    for (let col = 0; col < numCols; col++) {
      let dateScore = 0;
      let amountScore = 0;
      let descScore = 0;

      for (const row of sampleRows) {
        const cell = row[col];
        if (looksLikeDate(cell)) dateScore++;
        else if (looksLikeAmount(cell)) amountScore++;
        else if (cell && String(cell).trim().length > 3) descScore++;
      }

      colScores.push({ date: dateScore, desc: descScore, amount: amountScore });
    }

    if (dateCol === -1) {
      dateCol = colScores.reduce((best, s, i) => s.date > colScores[best].date ? i : best, 0);
    }
    if (amountCol === -1) {
      amountCol = colScores.reduce((best, s, i) => i !== dateCol && s.amount > colScores[best].amount ? i : best, 0);
    }
    if (descCol === -1) {
      descCol = colScores.reduce((best, s, i) => i !== dateCol && i !== amountCol && s.desc > colScores[best].desc ? i : best, 0);
    }
  }

  // Validate we have distinct columns
  if (new Set([dateCol, descCol, amountCol]).size < 3) return null;

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

async function extractPdfRows(file: File): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const rows: unknown[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group items by Y position (same line)
    const lineMap = new Map<number, { x: number; text: string }[]>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x: item.transform[4], text: item.str });
    }

    // Sort lines top to bottom, items left to right
    const sortedLines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x));

    for (const line of sortedLines) {
      const cells = line.map((i) => i.text.trim()).filter(Boolean);
      if (cells.length >= 2) {
        rows.push(cells);
      }
    }
  }

  return rows;
}

export function ImportModal({ existingTransactions, onImport, onClose }: Props) {
  const [items, setItems] = useState<(ImportItem & { isDuplicate: boolean })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'done'>('upload');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  // For manual mapping
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<unknown[][]>([]);
  const [manualMapping, setManualMapping] = useState<ColumnMapping>({ dateCol: 0, descCol: 1, amountCol: 2 });

  const processWithMapping = useCallback(
    (dataRows: unknown[][], mapping: ColumnMapping) => {
      const parsed: (ImportItem & { isDuplicate: boolean })[] = [];

      for (const row of dataRows) {
        const date = parseDate(row[mapping.dateCol]);
        const description = String(row[mapping.descCol] || '').trim();
        const amount = parseAmount(row[mapping.amountCol]);

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
        setError('Nenhuma transacao encontrada. Tente mapear as colunas manualmente.');
        setStep('mapping');
        return;
      }

      setItems(parsed);
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].isDuplicate)));
      setStep('preview');
    },
    [existingTransactions]
  );

  const processAllRows = useCallback(
    (allRows: unknown[][]) => {
      if (allRows.length < 2) {
        setError('Arquivo vazio ou invalido');
        return;
      }

      // Find the real header row (skip images, blank rows, bank logos)
      const found = findHeaderAndData(allRows);

      if (found) {
        const dataRows = allRows.slice(found.headerRow + 1);
        const mapping = detectColumns(found.headers, dataRows);

        setRawHeaders(found.headers);
        setRawData(dataRows);

        if (mapping) {
          setManualMapping(mapping);
          processWithMapping(dataRows, mapping);
        } else {
          // Could not auto-detect — go to manual mapping
          setStep('mapping');
        }
      } else {
        // No header found — try to detect from all rows
        // Use first non-empty row as potential header
        const firstRow = allRows.find((r) => r && r.length >= 2);
        if (!firstRow) {
          setError('Nao foi possivel ler o arquivo.');
          return;
        }
        const headers = firstRow.map((c) => String(c || ''));
        const dataRows = allRows.slice(allRows.indexOf(firstRow) + 1);

        setRawHeaders(headers);
        setRawData(dataRows);
        setStep('mapping');
      }
    },
    [processWithMapping]
  );

  function handleFile(file: File) {
    setError('');
    setFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      Papa.parse(file, {
        complete: (result) => processAllRows(result.data as unknown[][]),
        error: () => setError('Erro ao ler CSV'),
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
        processAllRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'pdf') {
      extractPdfRows(file)
        .then((rows) => processAllRows(rows))
        .catch(() => setError('Erro ao ler PDF. Tente exportar o extrato como Excel.'));
    } else {
      setError('Formato nao suportado. Use .xlsx, .xls, .csv ou .pdf');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function applyManualMapping() {
    setError('');
    processWithMapping(rawData, manualMapping);
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
  const selectClass = 'px-2 py-1.5 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent';

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
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-accent transition-colors cursor-pointer"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.xlsx,.xls,.csv,.pdf';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFile(file);
                };
                input.click();
              }}
            >
              <Upload size={32} className="mx-auto mb-3 text-text-secondary" />
              <p className="text-sm text-text-primary mb-1">Arraste seu extrato aqui</p>
              <p className="text-xs text-text-secondary">.xlsx .xls .csv .pdf</p>
            </div>
          )}

          {error && <p className="text-accent-red text-xs mt-3">{error}</p>}

          {/* MANUAL MAPPING */}
          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <Settings2 size={16} className="text-accent" />
                Mapear colunas manualmente
              </div>
              <p className="text-xs text-text-secondary">
                Nao consegui detectar as colunas automaticamente. Selecione qual coluna corresponde a cada campo:
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-text-secondary mb-1 uppercase tracking-wider">Coluna Data</label>
                  <select value={manualMapping.dateCol} onChange={(e) => setManualMapping({ ...manualMapping, dateCol: Number(e.target.value) })} className={selectClass}>
                    {rawHeaders.map((h, i) => (
                      <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-text-secondary mb-1 uppercase tracking-wider">Coluna Descricao</label>
                  <select value={manualMapping.descCol} onChange={(e) => setManualMapping({ ...manualMapping, descCol: Number(e.target.value) })} className={selectClass}>
                    {rawHeaders.map((h, i) => (
                      <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-text-secondary mb-1 uppercase tracking-wider">Coluna Valor</label>
                  <select value={manualMapping.amountCol} onChange={(e) => setManualMapping({ ...manualMapping, amountCol: Number(e.target.value) })} className={selectClass}>
                    {rawHeaders.map((h, i) => (
                      <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview of raw data */}
              <div className="overflow-auto max-h-[30vh] border border-border rounded">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-border bg-bg-secondary">
                      {rawHeaders.map((h, i) => (
                        <th key={i} className={`p-1.5 text-left ${i === manualMapping.dateCol ? 'text-accent' : i === manualMapping.descCol ? 'text-accent-green' : i === manualMapping.amountCol ? 'text-accent-red' : 'text-text-secondary'}`}>
                          {h || `Col ${i + 1}`}
                          {i === manualMapping.dateCol && ' [DATA]'}
                          {i === manualMapping.descCol && ' [DESC]'}
                          {i === manualMapping.amountCol && ' [VALOR]'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawData.slice(0, 8).map((row, i) => (
                      <tr key={i} className="border-b border-border/30">
                        {rawHeaders.map((_, ci) => (
                          <td key={ci} className="p-1.5 text-text-secondary truncate max-w-[150px]">
                            {String(row[ci] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={applyManualMapping}
                className="w-full py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
              >
                Aplicar mapeamento
              </button>
            </div>
          )}

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
                  {duplicateCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-accent">
                      <AlertTriangle size={14} />
                      {duplicateCount} duplicatas
                    </div>
                  )}
                  <button onClick={() => setStep('mapping')} className="text-xs text-text-secondary hover:text-accent flex items-center gap-1">
                    <Settings2 size={12} /> Remapear
                  </button>
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
                      <th className="p-2 text-right">Valor</th>
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
              <button onClick={() => { setStep('upload'); setItems([]); setError(''); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
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
