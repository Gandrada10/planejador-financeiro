import { useMemo, useState, useRef } from 'react';
import { FileSpreadsheet, Check, X, AlertTriangle, ShieldAlert, RefreshCw, CreditCard, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useTransactions } from '../../hooks/useTransactions';
import { useAccounts } from '../../hooks/useAccounts';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { normalizeDescriptionForDedup, fuzzyMatchMember, formatDate } from '../../lib/utils';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { Transaction, TitularMapping } from '../../types';

// ─── Parser determinístico da fatura "Meu Dinheiro Web" ──────────────────────
//
// A planilha exportada tem um cabeçalho de tabela na linha
// "Data | Lançamento | Parcelamento | Valor | (vazio) | Titularidade | Nome |
//  Tipo do cartão | Número do cartão" e, abaixo, uma linha por lançamento.
// Como as colunas são conhecidas, lemos direto (sem IA): é a MESMA informação
// de membro/cartão que faltou entrar no import original.

interface InvoiceRow {
  file: string;
  purchaseDate: Date; // data da compra (coluna "Data")
  description: string;
  magnitude: number; // |valor| — casamos por magnitude (a IA inverte o sinal no import)
  installmentNumber: number | null;
  totalInstallments: number | null;
  cardLast4: string | null;
  nome: string;
  titularidade: string;
}

interface ParsedFile {
  name: string;
  count: number;
}

/** Converte "dd/mm/aaaa" numa Date ao meio-dia local (evita drift de fuso). */
function parseDMY(raw: unknown): Date | null {
  const m = String(raw ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
}

/**
 * Lê o valor monetário tolerando os dois locales: US ("1,076.90" — vírgula de
 * milhar, ponto decimal, formato destes arquivos) e pt-BR ("1.076,90"). Decide
 * pelo último separador. Devolve o valor ASSINADO da planilha (compra positiva,
 * estorno/pagamento negativo).
 */
function parseInvoiceMoney(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').replace(/R\$/i, '').replace(/\s/g, '').trim();
  if (!s) return NaN;
  s = s.replace(/[^0-9.,-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.'); // pt-BR
  } else {
    s = s.replace(/,/g, ''); // US
  }
  return parseFloat(s);
}

/** Lê um .xlsx de fatura e devolve as linhas + o cartão declarado no cabeçalho. */
function parseInvoiceXlsx(fileName: string, buffer: ArrayBuffer): { card: string | null; rows: InvoiceRow[] } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const rows: InvoiceRow[] = [];
  let card: string | null = null;

  for (const sn of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
    const hdr = grid.findIndex(
      (r) => String(r[1] ?? '').trim() === 'Data' && String(r[2] ?? '').trim() === 'Lançamento'
    );
    if (hdr < 0) continue;

    if (!card) {
      const cardCell = grid.flat().find((c) => /final\s*\d{4}/i.test(String(c)));
      if (cardCell) card = String(cardCell).trim();
    }

    for (let i = hdr + 1; i < grid.length; i++) {
      const r = grid[i];
      const purchaseDate = parseDMY(r[1]); // só entram linhas com data válida (pula totais/rodapés)
      if (!purchaseDate) continue;
      const description = String(r[2] ?? '').trim();
      if (!description) continue;
      const val = parseInvoiceMoney(r[4]);
      if (!Number.isFinite(val)) continue;
      const parc = String(r[3] ?? '').match(/(\d{1,2})\s*de\s*(\d{1,2})/i);
      const last4 = String(r[9] ?? '').match(/(\d{4})\s*$/);
      rows.push({
        file: fileName,
        purchaseDate,
        description,
        magnitude: Math.abs(val),
        installmentNumber: parc ? parseInt(parc[1], 10) : null,
        totalInstallments: parc ? parseInt(parc[2], 10) : null,
        cardLast4: last4 ? last4[1] : null,
        nome: String(r[7] ?? '').trim(),
        titularidade: String(r[6] ?? '').trim(),
      });
    }
  }
  return { card, rows };
}

/** Mesma tolerância de data do ImportModal: bate se qualquer par de datas alinha. */
function datesMatch(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.toDateString() === b.toDateString();
}

/** Resolve o membro cadastrado de uma linha: dígitos do cartão primeiro, depois o Nome (fuzzy). */
function resolveMember(row: InvoiceRow, memberNames: string[], mappings: TitularMapping[]): string {
  if (row.cardLast4) {
    const m = mappings.find((mp) => mp.cardLastDigits === row.cardLast4);
    if (m && memberNames.includes(m.titularName)) return m.titularName;
  }
  return fuzzyMatchMember(row.nome || '', memberNames);
}

type Phase = 'idle' | 'previewed' | 'applying' | 'done';

interface PlannedUpdate {
  id: string;
  data: Partial<Transaction>;
  // p/ a amostra do preview:
  description: string;
  date: Date;
  fills: string[]; // ex.: ['conta', 'membro']
}

export function BackfillInvoiceFields() {
  const { transactions, loading, batchUpdateVarying } = useTransactions();
  const { cardAccounts, loading: loadingAccounts } = useAccounts();
  const { memberNames, loading: loadingMembers } = useFamilyMembers();
  const { mappings } = useTitularMappings();

  const [phase, setPhase] = useState<Phase>('idle');
  const [parsedRows, setParsedRows] = useState<InvoiceRow[]>([]);
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [detectedCard, setDetectedCard] = useState<string | null>(null);
  const [targetAccount, setTargetAccount] = useState('');
  const [userPickedAccount, setUserPickedAccount] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; conta: number; membro: number; cartao: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Conta-alvo padrão: o cartão cadastrado cujo nome lembra a fatura (latam/black/
  // itaú), senão o único cartão. O usuário pode trocar no seletor.
  const defaultAccount = useMemo(() => {
    if (cardAccounts.length === 0) return '';
    const hay = (detectedCard || '').toLowerCase();
    const guess = cardAccounts.find((a) => {
      const n = a.name.toLowerCase();
      return /latam|black/.test(n) || (hay && ['latam', 'black', 'itau', 'itaú'].some((k) => n.includes(k)));
    });
    return (guess || (cardAccounts.length === 1 ? cardAccounts[0] : undefined))?.name || '';
  }, [cardAccounts, detectedCard]);

  // Conta efetiva: o palpite automático até o usuário escolher explicitamente
  // (deriva do estado, sem efeito colateral que dispararia re-render em cascata).
  const effectiveAccount = userPickedAccount ? targetAccount : defaultAccount;

  // Índice das linhas de fatura por (descrição normalizada + magnitude).
  const indexByKey = useMemo(() => {
    const map = new Map<string, InvoiceRow[]>();
    for (const r of parsedRows) {
      const key = `${normalizeDescriptionForDedup(r.description)}|${r.magnitude.toFixed(2)}`;
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return map;
  }, [parsedRows]);

  // ─── Plano (dry-run puro — não escreve) ────────────────────────────────────
  const plan = useMemo(() => {
    const updates: PlannedUpdate[] = [];
    let contaFills = 0;
    let membroFills = 0;
    let cartaoFills = 0;
    let conflicts = 0;
    let matchedTx = 0;
    let unmatched = 0;
    let candidates = 0;

    if (parsedRows.length === 0) {
      return { updates, contaFills, membroFills, cartaoFills, conflicts, matchedTx, unmatched, candidates };
    }

    for (const t of transactions) {
      const noConta = !(t.account || '').trim();
      const noMembro = !(t.familyMember || '').trim();
      const noCartao = !(t.cardNumber || '').trim();
      if (!noConta && !noMembro && !noCartao) continue; // já preenchida — não mexe
      candidates++;

      const key = `${normalizeDescriptionForDedup(t.description)}|${Math.abs(t.amount).toFixed(2)}`;
      const matches = (indexByKey.get(key) || []).filter((r) => {
        if (!(datesMatch(r.purchaseDate, t.purchaseDate) || datesMatch(r.purchaseDate, t.date))) return false;
        // Cartão divergente bloqueia (evita contaminar lançamento de outro cartão).
        if (t.cardNumber && r.cardLast4 && t.cardNumber.slice(-4) !== r.cardLast4) return false;
        return true;
      });
      if (matches.length === 0) {
        unmatched++;
        continue;
      }
      matchedTx++;

      const memberSet = new Set(matches.map((r) => resolveMember(r, memberNames, mappings)).filter(Boolean));
      const cardSet = new Set(matches.map((r) => r.cardLast4).filter(Boolean) as string[]);

      const data: Partial<Transaction> = {};
      const fills: string[] = [];
      let hadConflict = false;

      if (noConta && effectiveAccount) {
        data.account = effectiveAccount;
        fills.push('conta');
      }

      if (noMembro) {
        if (memberSet.size === 1) {
          const member = [...memberSet][0];
          const rawTitular = (t.titular || '').trim();
          const titularResolved = rawTitular ? fuzzyMatchMember(rawTitular, memberNames) : '';
          // Só preenche o membro quando o titular atual está vazio OU já aponta
          // para a MESMA pessoa (canonicaliza). Nunca troca por outra pessoa.
          if (!rawTitular || titularResolved === member) {
            data.familyMember = member;
            data.titular = member;
            fills.push('membro');
          } else {
            hadConflict = true;
          }
        } else if (memberSet.size > 1) {
          hadConflict = true;
        }
      }

      if (noCartao && cardSet.size === 1) {
        data.cardNumber = [...cardSet][0];
        fills.push('cartão');
      }

      if (Object.keys(data).length === 0) {
        if (hadConflict) conflicts++;
        continue;
      }
      if (data.account !== undefined) contaFills++;
      if (data.familyMember !== undefined) membroFills++;
      if (data.cardNumber !== undefined) cartaoFills++;
      if (hadConflict) conflicts++;
      updates.push({ id: t.id, data, description: t.description, date: t.date, fills });
    }

    return { updates, contaFills, membroFills, cartaoFills, conflicts, matchedTx, unmatched, candidates };
  }, [transactions, indexByKey, parsedRows.length, effectiveAccount, memberNames, mappings]);

  // ─── Ações ─────────────────────────────────────────────────────────────────
  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setResult(null);
    try {
      const allRows: InvoiceRow[] = [];
      const meta: ParsedFile[] = [];
      let card: string | null = null;
      for (const file of Array.from(fileList)) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext !== 'xlsx' && ext !== 'xls') {
          setError(`"${file.name}" não é uma planilha .xlsx/.xls.`);
          return;
        }
        const buffer = await file.arrayBuffer();
        const { card: c, rows } = parseInvoiceXlsx(file.name, buffer);
        if (c && !card) card = c;
        allRows.push(...rows);
        meta.push({ name: file.name, count: rows.length });
      }
      if (allRows.length === 0) {
        setError('Nenhum lançamento encontrado nas planilhas. Confirme que é a fatura exportada do Meu Dinheiro Web.');
        return;
      }
      setParsedRows(allRows);
      setParsedFiles(meta);
      setDetectedCard(card);
      setUserPickedAccount(false);
      setPhase('previewed');
    } catch (err) {
      setError(`Erro ao ler as planilhas: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleApply() {
    setConfirmOpen(false);
    setError(null);
    setPhase('applying');
    const updates = plan.updates;
    setProgress({ current: 0, total: updates.length });
    try {
      // Aplica em fatias para dar progresso; batchUpdateVarying já comita em
      // blocos de 400 internamente. Cada id recebe SÓ os campos que estavam
      // vazios (nada é sobrescrito).
      const SLICE = 200;
      for (let i = 0; i < updates.length; i += SLICE) {
        const chunk = updates.slice(i, i + SLICE).map((u) => ({ id: u.id, data: u.data }));
        await batchUpdateVarying(chunk);
        setProgress({ current: Math.min(i + SLICE, updates.length), total: updates.length });
      }
      setResult({
        updated: updates.length,
        conta: plan.contaFills,
        membro: plan.membroFills,
        cartao: plan.cartaoFills,
      });
      setPhase('done');
    } catch (err) {
      setError(`Erro ao aplicar: ${err instanceof Error ? err.message : String(err)}`);
      setPhase('previewed');
    }
  }

  function reset() {
    setPhase('idle');
    setParsedRows([]);
    setParsedFiles([]);
    setDetectedCard(null);
    setAcknowledged(false);
    setResult(null);
    setError(null);
    setProgress({ current: 0, total: 0 });
    setUserPickedAccount(false);
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading || loadingAccounts || loadingMembers) {
    return <p className="text-xs text-text-secondary animate-pulse">Carregando lançamentos...</p>;
  }

  const inputClass =
    'px-2 py-1.5 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent';
  const nothingToDo = phase === 'previewed' && plan.updates.length === 0;

  return (
    <div className="space-y-3">
      {/* Guarda-corpo */}
      <div className="flex items-start gap-2 bg-accent-red/5 border border-accent-red/40 rounded p-2.5">
        <ShieldAlert size={14} className="text-accent-red flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[11px] text-text-secondary leading-snug">
          <strong className="text-text-primary">Faça um backup antes</strong> (Configurações → Backup e
          Restauração → Gerar backup completo). Esta ação preenche <strong className="text-text-primary">conta,
          membro e número do cartão</strong> nos lançamentos importados — <strong className="text-text-primary">só
          onde estiverem vazios</strong> e apenas quando baterem com uma linha da fatura. Nada é apagado nem
          sobrescrito; nada é gravado até você pré-visualizar e confirmar.
        </p>
      </div>

      {error && (
        <p className="text-[11px] font-bold text-accent-red flex items-center gap-1" role="alert">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {/* Passo 1 — upload */}
      {phase === 'idle' && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <Upload size={13} /> Selecionar faturas (.xlsx) do Meu Dinheiro Web
          </button>
          <p className="text-[10px] text-text-secondary">
            Pode selecionar as 5 faturas (janeiro a maio) de uma vez. A leitura é local, no seu navegador.
          </p>
        </>
      )}

      {/* Progresso */}
      {phase === 'applying' && (
        <div className="space-y-2">
          <p className="text-xs text-text-primary flex items-center gap-2">
            <RefreshCw size={13} className="animate-spin text-accent" />
            Aplicando... {progress.current} / {progress.total}
          </p>
          <div className="w-full bg-bg-secondary rounded-full h-2">
            <div
              className="bg-accent h-2 rounded-full transition-all"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Resultado */}
      {phase === 'done' && result && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-accent-green flex items-center gap-1">
            <Check size={12} /> {result.updated} lançamento(s) atualizado(s) — conta: {result.conta}, membro:{' '}
            {result.membro}, cartão: {result.cartao}.
          </p>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <RefreshCw size={13} /> Rodar de novo
          </button>
        </div>
      )}

      {/* Pré-visualização */}
      {phase === 'previewed' && (
        <div className="space-y-3">
          {/* Arquivos lidos */}
          <div className="bg-bg-secondary rounded p-2.5 space-y-1">
            <p className="text-[11px] font-bold text-text-primary flex items-center gap-1.5">
              <FileSpreadsheet size={12} className="text-accent" /> {parsedFiles.length} arquivo(s) ·{' '}
              {parsedRows.length} linha(s) de fatura
            </p>
            {detectedCard && <p className="text-[10px] text-text-secondary">Cartão na fatura: {detectedCard}</p>}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {parsedFiles.map((f) => (
                <span key={f.name} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-secondary">
                  {f.name} <span className="text-text-primary/70">· {f.count}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Conta-alvo */}
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="backfill-account" className="text-[11px] text-text-secondary flex items-center gap-1.5">
              <CreditCard size={12} className="text-accent" /> Conta/cartão a preencher:
            </label>
            {cardAccounts.length > 0 ? (
              <select
                id="backfill-account"
                value={effectiveAccount}
                onChange={(e) => {
                  setTargetAccount(e.target.value);
                  setUserPickedAccount(true);
                }}
                className={`${inputClass} font-bold min-w-[180px]`}
              >
                <option value="">— não preencher conta —</option>
                {cardAccounts.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-status-warn">
                Nenhum cartão cadastrado — cadastre em Contas e Cartões para preencher a conta.
              </span>
            )}
          </div>

          {nothingToDo ? (
            <p className="text-[11px] text-accent-green font-bold flex items-center gap-1">
              <Check size={12} /> Nada a preencher — os lançamentos que batem com as faturas já têm conta e membro.
            </p>
          ) : (
            <>
              {/* Resumo do plano */}
              <div className="text-[11px] text-text-secondary space-y-0.5">
                <p>
                  <strong className="text-text-primary">{plan.updates.length}</strong> lançamento(s) serão
                  atualizados — conta: <strong className="text-text-primary">{plan.contaFills}</strong>, membro:{' '}
                  <strong className="text-text-primary">{plan.membroFills}</strong>, cartão:{' '}
                  <strong className="text-text-primary">{plan.cartaoFills}</strong>.
                </p>
                <p>
                  {plan.matchedTx} candidata(s) casaram com a fatura · {plan.unmatched} sem correspondência (ficam
                  como estão)
                  {plan.conflicts > 0 && (
                    <>
                      {' '}
                      · <span className="text-status-warn font-bold">{plan.conflicts} conflito(s) de membro ignorado(s)</span>
                    </>
                  )}
                </p>
                <p className="text-[10px]">
                  Só campos vazios são escritos. "Membro" preenche o campo Membro e sincroniza o Titular ao mesmo
                  membro cadastrado (nunca troca por outra pessoa).
                </p>
              </div>

              {/* Amostra */}
              {plan.updates.length > 0 && (
                <div className="max-h-56 overflow-y-auto border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-bg-card">
                      <tr className="text-text-secondary border-b border-border">
                        <th className="p-1.5 text-left">Data</th>
                        <th className="p-1.5 text-left">Descrição</th>
                        <th className="p-1.5 text-left">Preenche</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.updates.slice(0, 60).map((u) => (
                        <tr key={u.id} className="border-b border-border/40">
                          <td className="p-1.5 text-text-secondary whitespace-nowrap tnum">{formatDate(u.date)}</td>
                          <td className="p-1.5 text-text-primary">{u.description}</td>
                          <td className="p-1.5 text-text-secondary whitespace-nowrap">
                            {u.fills.join(', ')}
                            {u.data.familyMember ? ` (${u.data.familyMember})` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.updates.length > 60 && (
                    <p className="text-[10px] text-text-secondary p-1.5">
                      … e mais {plan.updates.length - 60} lançamento(s).
                    </p>
                  )}
                </div>
              )}

              {/* Ack + aplicar */}
              <label className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)]"
                />
                <span>Li o aviso e já fiz um backup completo dos meus dados.</span>
              </label>
            </>
          )}

          <div className="flex gap-2">
            {!nothingToDo && (
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={!acknowledged || plan.updates.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={13} /> Aplicar ({plan.updates.length})
              </button>
            )}
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
            >
              <X size={13} /> {nothingToDo ? 'Fechar' : 'Cancelar'}
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Preencher conta e membro?"
          message={`${plan.updates.length} lançamento(s) receberão os campos vazios (conta: ${plan.contaFills}, membro: ${plan.membroFills}, cartão: ${plan.cartaoFills}) a partir das faturas. Só campos vazios são escritos — nada é apagado. Confirme que você fez o backup.`}
          confirmLabel="Aplicar agora"
          cancelLabel="Cancelar"
          onConfirm={handleApply}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
