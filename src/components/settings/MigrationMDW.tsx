import { useRef, useState, useMemo } from 'react';
import { RefreshCw, Check, X, AlertTriangle, FileSpreadsheet, ArrowRight, Plus } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  collection,
  writeBatch,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import type { Category } from '../../types';

// ---------- types ----------

interface RawRow {
  tipo: string;
  data: string;
  vencFatura: string;
  valor: number;
  descricao: string;
  categoria: string;
  conta: string;
  subcategoria: string;
  dataCompetencia: string;
  cartao: string;
}

type CategoryAction =
  | { kind: 'matched'; categoryId: string }
  | { kind: 'create' }
  | { kind: 'assign'; categoryId: string }
  | { kind: 'skip' };

interface UnmatchedCategory {
  name: string;
  parentName: string | null; // null = root, string = subcategoria de parentName
  count: number;
  action: CategoryAction;
}

type Step = 'idle' | 'preview' | 'resolve' | 'importing' | 'done';

// ---------- helpers ----------

function parseDate(s: string): Date | null {
  if (!s) return null;
  // Try DD/MM/YYYY
  const parts = s.split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  // Try ISO
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;
  return null;
}

function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function normalizeStr(s: string): string {
  return (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const BATCH_LIMIT = 450;

// ---------- component ----------

export function MigrationMDW() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { categories, addCategory } = useCategories();
  const { accounts } = useAccounts();

  const [step, setStep] = useState<Step>('idle');
  const [rows, setRows] = useState<RawRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  // Category lookup helpers
  const rootCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  const subCategories = useMemo(() => {
    const map = new Map<string, Category[]>();
    categories.filter(c => c.parentId).forEach(c => {
      const list = map.get(c.parentId!) || [];
      list.push(c);
      map.set(c.parentId!, list);
    });
    return map;
  }, [categories]);

  function findCategory(catName: string, subName: string): string | null {
    const normCat = normalizeStr(catName);
    const normSub = normalizeStr(subName);
    if (normSub) {
      // Find parent first
      const parent = rootCategories.find(c => normalizeStr(c.name) === normCat);
      if (parent) {
        const subs = subCategories.get(parent.id) || [];
        const sub = subs.find(s => normalizeStr(s.name) === normSub);
        if (sub) return sub.id;
      }
    }
    if (normCat) {
      const root = rootCategories.find(c => normalizeStr(c.name) === normCat);
      if (root) return root.id;
    }
    return null;
  }

  function findAccount(contaName: string): string {
    const norm = normalizeStr(contaName);
    const acc = accounts.find(a => normalizeStr(a.name) === norm);
    return acc?.id || '';
  }

  // ---------- Step 1: Read file ----------

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResultMsg(null);

    const reader = new FileReader();
    reader.onerror = () => setError('Falha ao ler arquivo.');
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        if (jsonRows.length === 0) {
          setError('Planilha vazia.');
          return;
        }

        // Map columns - flexible header matching
        const headers = Object.keys(jsonRows[0]);
        const colMap = mapColumns(headers);

        const parsed: RawRow[] = jsonRows.map(row => ({
          tipo: String(row[colMap.tipo] || '').trim(),
          data: String(row[colMap.data] || '').trim(),
          vencFatura: String(row[colMap.vencFatura] || '').trim(),
          valor: parseNumber(row[colMap.valor]),
          descricao: String(row[colMap.descricao] || '').trim(),
          categoria: String(row[colMap.categoria] || '').trim(),
          conta: String(row[colMap.conta] || '').trim(),
          subcategoria: String(row[colMap.subcategoria] || '').trim(),
          dataCompetencia: String(row[colMap.dataCompetencia] || '').trim(),
          cartao: String(row[colMap.cartao] || '').trim(),
        })).filter(r => r.descricao && r.valor !== 0);

        setRows(parsed);

        // Find unmatched categories
        const unmatchedMap = new Map<string, UnmatchedCategory>();

        for (const r of parsed) {
          // Check subcategoria
          if (r.subcategoria) {
            const catId = findCategory(r.categoria, r.subcategoria);
            if (!catId) {
              const key = `${normalizeStr(r.categoria)}::${normalizeStr(r.subcategoria)}`;
              const existing = unmatchedMap.get(key);
              if (existing) {
                existing.count++;
              } else {
                unmatchedMap.set(key, {
                  name: r.subcategoria,
                  parentName: r.categoria,
                  count: 1,
                  action: { kind: 'create' },
                });
              }
            }
          } else if (r.categoria) {
            const catId = findCategory(r.categoria, '');
            if (!catId) {
              const key = normalizeStr(r.categoria);
              const existing = unmatchedMap.get(key);
              if (existing) {
                existing.count++;
              } else {
                unmatchedMap.set(key, {
                  name: r.categoria,
                  parentName: null,
                  count: 1,
                  action: { kind: 'create' },
                });
              }
            }
          }
        }

        const unmatchedList = Array.from(unmatchedMap.values()).sort((a, b) => b.count - a.count);
        setUnmatched(unmatchedList);

        if (unmatchedList.length > 0) {
          setStep('resolve');
        } else {
          setStep('preview');
        }
      } catch (err) {
        setError(`Erro ao processar: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function mapColumns(headers: string[]): Record<string, string> {
    const find = (patterns: string[]) => {
      for (const p of patterns) {
        const h = headers.find(h => normalizeStr(h).includes(normalizeStr(p)));
        if (h) return h;
      }
      return headers[0];
    };
    return {
      tipo: find(['tipo']),
      data: find(['data']),
      vencFatura: find(['venc', 'fatura']),
      valor: find(['valor']),
      descricao: find(['descri']),
      categoria: find(['categoria']),
      conta: find(['conta']),
      subcategoria: find(['subcategoria', 'sub categoria', 'sub-categoria']),
      dataCompetencia: find(['competencia', 'competência']),
      cartao: find(['cartao', 'cartão']),
    };
  }

  // ---------- Step 2: Update unmatched action ----------

  function updateAction(idx: number, action: CategoryAction) {
    setUnmatched(prev => prev.map((u, i) => i === idx ? { ...u, action } : u));
  }

  // ---------- Step 3: Import ----------

  async function handleImport() {
    const user = auth.currentUser;
    if (!user) { setError('Nao autenticado.'); return; }

    setStep('importing');
    setError(null);
    const uid = user.uid;
    const batchId = `mdw-${Date.now()}`;

    try {
      // 1. Create new categories as needed
      const newCategoryIds = new Map<string, string>(); // key -> new category id

      for (const u of unmatched) {
        if (u.action.kind === 'create') {
          let parentId: string | null = null;
          if (u.parentName) {
            // Find or create parent
            const parent = rootCategories.find(c => normalizeStr(c.name) === normalizeStr(u.parentName!));
            if (parent) {
              parentId = parent.id;
            } else {
              // Check if we already created this parent
              const parentKey = normalizeStr(u.parentName);
              if (newCategoryIds.has(parentKey)) {
                parentId = newCategoryIds.get(parentKey)!;
              } else {
                const newId = await addCategory({
                  name: u.parentName,
                  icon: 'circle',
                  color: '#6b7280',
                  type: 'despesa',
                  parentId: null,
                });
                newCategoryIds.set(parentKey, newId);
                parentId = newId;
              }
            }
          }
          const newId = await addCategory({
            name: u.name,
            icon: 'circle',
            color: '#6b7280',
            type: 'despesa',
            parentId,
          });
          const key = u.parentName
            ? `${normalizeStr(u.parentName)}::${normalizeStr(u.name)}`
            : normalizeStr(u.name);
          newCategoryIds.set(key, newId);
        }
      }

      // 2. Build category resolution map
      const resolutionMap = new Map<string, string | null>();
      for (const u of unmatched) {
        const key = u.parentName
          ? `${normalizeStr(u.parentName)}::${normalizeStr(u.name)}`
          : normalizeStr(u.name);

        if (u.action.kind === 'create') {
          resolutionMap.set(key, newCategoryIds.get(key) || null);
        } else if (u.action.kind === 'assign') {
          resolutionMap.set(key, u.action.categoryId);
        } else if (u.action.kind === 'skip') {
          resolutionMap.set(key, null);
        }
      }

      // 3. Build transaction documents
      const txDocs: Array<Record<string, unknown>> = [];

      for (const r of rows) {
        // Resolve category
        let categoryId: string | null = null;
        if (r.subcategoria) {
          categoryId = findCategory(r.categoria, r.subcategoria);
          if (!categoryId) {
            const key = `${normalizeStr(r.categoria)}::${normalizeStr(r.subcategoria)}`;
            categoryId = resolutionMap.get(key) || null;
          }
        } else if (r.categoria) {
          categoryId = findCategory(r.categoria, '');
          if (!categoryId) {
            categoryId = resolutionMap.get(normalizeStr(r.categoria)) || null;
          }
        }

        // Resolve account
        const accountId = findAccount(r.conta);

        // Determine dates
        const isCard = !!r.vencFatura || !!r.cartao;
        let date: Date;
        let purchaseDate: Date | null = null;

        if (isCard) {
          // For cards: date = vencFatura (invoice date), purchaseDate = data (purchase date)
          date = parseDate(r.vencFatura) || parseDate(r.data) || new Date();
          purchaseDate = parseDate(r.dataCompetencia) || parseDate(r.data) || null;
        } else {
          date = parseDate(r.data) || new Date();
          purchaseDate = parseDate(r.dataCompetencia) || null;
        }

        // Amount: negative for expenses
        const isReceita = normalizeStr(r.tipo).includes('receita');
        const amount = isReceita ? Math.abs(r.valor) : -Math.abs(r.valor);

        txDocs.push({
          date: Timestamp.fromDate(date),
          purchaseDate: purchaseDate ? Timestamp.fromDate(purchaseDate) : null,
          description: r.descricao,
          amount,
          categoryId,
          account: accountId,
          familyMember: '',
          titular: r.cartao || '',
          installmentNumber: null,
          totalInstallments: null,
          cardNumber: null,
          projectId: null,
          pluggyTransactionId: null,
          tags: [],
          notes: '',
          importBatch: batchId,
          reconciled: false,
          reconciledAt: null,
          createdAt: Timestamp.fromDate(new Date()),
        });
      }

      // 4. Write in batches
      setProgress({ current: 0, total: txDocs.length });
      const colRef = collection(db, 'users', uid, 'transactions');

      for (let i = 0; i < txDocs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        const chunk = txDocs.slice(i, i + BATCH_LIMIT);
        for (const txData of chunk) {
          batch.set(doc(colRef), txData);
        }
        await batch.commit();
        setProgress({ current: Math.min(i + BATCH_LIMIT, txDocs.length), total: txDocs.length });
      }

      setResultMsg(`${txDocs.length} lancamentos importados com sucesso!`);
      setStep('done');
    } catch (err) {
      setError(`Erro na importacao: ${err instanceof Error ? err.message : String(err)}`);
      setStep('resolve');
    }
  }

  // ---------- render ----------

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const receitas = rows.filter(r => normalizeStr(r.tipo).includes('receita'));
    const despesas = rows.filter(r => !normalizeStr(r.tipo).includes('receita'));
    const totalReceitas = receitas.reduce((s, r) => s + Math.abs(r.valor), 0);
    const totalDespesas = despesas.reduce((s, r) => s + Math.abs(r.valor), 0);
    const contasSet = new Set(rows.map(r => r.conta).filter(Boolean));
    const catsSet = new Set(rows.map(r => r.categoria).filter(Boolean));
    return { receitas: receitas.length, despesas: despesas.length, totalReceitas, totalDespesas, contas: contasSet.size, categorias: catsSet.size, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* File input */}
      {(step === 'idle' || step === 'done') && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <FileSpreadsheet size={13} /> Selecionar arquivo Excel/CSV do Meu Dinheiro Web
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] font-bold text-accent-red flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {resultMsg && (
        <p className="text-[11px] font-bold text-accent-green flex items-center gap-1">
          <Check size={12} /> {resultMsg}
        </p>
      )}

      {/* Summary */}
      {summary && step !== 'idle' && (
        <div className="bg-bg-secondary rounded p-3 space-y-1 text-[10px] text-text-secondary">
          <p className="font-bold text-text-primary text-xs">Resumo do arquivo:</p>
          <p>Total de lancamentos: <strong className="text-text-primary">{summary.total}</strong></p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <p>Receitas: <strong className="text-accent-green">{summary.receitas}</strong> (R$ {summary.totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</p>
            <p>Despesas: <strong className="text-accent-red">{summary.despesas}</strong> (R$ {summary.totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</p>
            <p>Contas: <strong>{summary.contas}</strong></p>
            <p>Categorias: <strong>{summary.categorias}</strong></p>
          </div>
        </div>
      )}

      {/* Preview - no unmatched categories */}
      {step === 'preview' && (
        <div className="space-y-2">
          <p className="text-[11px] text-accent-green font-bold flex items-center gap-1">
            <Check size={12} /> Todas as categorias foram encontradas no sistema!
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
            >
              <ArrowRight size={13} /> Importar {rows.length} lancamentos
            </button>
            <button
              onClick={() => { setStep('idle'); setRows([]); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
            >
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Resolve unmatched categories */}
      {step === 'resolve' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-text-secondary">
              <strong className="text-text-primary">{unmatched.length} categorias</strong> do arquivo nao foram encontradas no sistema. Escolha o que fazer com cada uma:
            </p>
          </div>

          <div className="max-h-[400px] overflow-y-auto space-y-1.5">
            {unmatched.map((u, idx) => (
              <div key={idx} className="bg-bg-secondary rounded p-2 flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <span className="text-xs text-text-primary font-bold">{u.name}</span>
                  {u.parentName && (
                    <span className="text-[10px] text-text-secondary ml-1">(em {u.parentName})</span>
                  )}
                  <span className="text-[10px] text-text-secondary ml-2">{u.count} lancamentos</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateAction(idx, { kind: 'create' })}
                    className={`px-2 py-1 text-[10px] rounded ${u.action.kind === 'create' ? 'bg-accent text-bg-primary font-bold' : 'bg-bg-card border border-border text-text-secondary hover:border-accent'}`}
                  >
                    <Plus size={10} className="inline mr-0.5" /> Criar
                  </button>
                  <select
                    value={u.action.kind === 'assign' ? u.action.categoryId : ''}
                    onChange={(e) => {
                      if (e.target.value) updateAction(idx, { kind: 'assign', categoryId: e.target.value });
                    }}
                    className={`px-1.5 py-1 text-[10px] rounded bg-bg-card border ${u.action.kind === 'assign' ? 'border-accent text-text-primary' : 'border-border text-text-secondary'} max-w-[180px]`}
                  >
                    <option value="">Atribuir a...</option>
                    {rootCategories.map(c => (
                      <optgroup key={c.id} label={c.name}>
                        <option value={c.id}>{c.name}</option>
                        {(subCategories.get(c.id) || []).map(s => (
                          <option key={s.id} value={s.id}>  {s.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    onClick={() => updateAction(idx, { kind: 'skip' })}
                    className={`px-2 py-1 text-[10px] rounded ${u.action.kind === 'skip' ? 'bg-accent-red/20 text-accent-red font-bold border border-accent-red/50' : 'bg-bg-card border border-border text-text-secondary hover:border-accent'}`}
                  >
                    Sem categoria
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
            >
              <ArrowRight size={13} /> Importar {rows.length} lancamentos
            </button>
            <button
              onClick={() => { setStep('idle'); setRows([]); setUnmatched([]); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
            >
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Importing progress */}
      {step === 'importing' && (
        <div className="space-y-2">
          <p className="text-xs text-text-primary flex items-center gap-2">
            <RefreshCw size={13} className="animate-spin text-accent" />
            Importando... {progress.current} / {progress.total}
          </p>
          <div className="w-full bg-bg-secondary rounded-full h-2">
            <div
              className="bg-accent h-2 rounded-full transition-all"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
