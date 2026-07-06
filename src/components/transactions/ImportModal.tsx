import { useState, useMemo, useEffect } from 'react';
import { X, FileSpreadsheet, AlertTriangle, Check, Sparkles, CreditCard, ChevronDown, Zap, UserX, CalendarClock, Landmark } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import type { Transaction, Category, Account, CategoryRule, Project } from '../../types';
import { parseOfx, type OfxParseMeta } from '../../lib/parseOfx';
import { NoteTag } from '../shared/NoteTag';
import {
  formatBRL,
  formatDate,
  getMonthYear,
  getMonthLabel,
  filterCategoriesByAmount,
  normalizeTitular,
  extractTrailingInstallment,
  normalizeDescriptionForDedup,
  fuzzyMatchMember,
  invoiceDateFor,
} from '../../lib/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;
type ImportRow = ImportItem & {
  isDuplicate: boolean;
  installmentType: 'unica' | 'parcelada';
  periodicity: number; // months between installments
  installmentAmount: number | null;
};

function datesMatch(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.toDateString() === b.toDateString();
}

function isDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  const itemDescNorm = normalizeDescriptionForDedup(item.description);
  return existing.some((t) => {
    if (Math.abs(t.amount - item.amount) >= 0.01) return false;
    if (normalizeDescriptionForDedup(t.description) !== itemDescNorm) return false;
    // Match if any date pair aligns — handles the case where one side stores
    // the billing/invoice date while the other stores the original purchase date.
    return (
      datesMatch(t.date, item.date) ||
      datesMatch(t.purchaseDate, item.purchaseDate) ||
      datesMatch(t.date, item.purchaseDate) ||
      datesMatch(t.purchaseDate, item.date)
    );
  });
}

// Teto de tamanho para o arquivo OFX (~15 MB). Extrato de conta corrente é
// texto puro e nunca chega perto disso — o teto só existe pra rejeitar
// arquivo errado/malicioso antes de carregar os bytes na memória.
const OFX_MAX_BYTES = 15_000_000;

// ─── OFX (conta corrente) — dedupe, encoding e auto-match de conta ─────────
//
// Irmão do caminho de IA acima: dedupe primeiro pelo FITID (chave natural do
// OFX, id estável emitido pelo próprio banco). FITID é único
// POR CONTA, não global (dois bancos podem emitir o mesmo FITID) — por isso só
// tratamos como duplicata quando a CONTA de destino também casa. Sem conta
// definida na linha OFX, ou sem match de conta, caímos no fallback por
// data+valor+descrição, que não corre esse risco de colisão entre contas.
function isOfxDuplicate(item: ImportItem, existing: Transaction[]): boolean {
  if (item.fitid && item.account) {
    const fitidMatch = existing.some(
      (t) => t.fitid === item.fitid && t.account === item.account
    );
    if (fitidMatch) return true;
  }
  return isDuplicate(item, existing);
}

// BANKID (OFX) → padrões de nome/banco, para auto-selecionar a conta de
// destino quando existe uma conta corrente cadastrada daquele banco. Best
// effort: sem match, cai para seleção manual (MVP), como combinado.
const OFX_BANK_HINTS: Record<string, string[]> = {
  '1': ['banco do brasil', ' bb '],
  '33': ['santander'],
  '77': ['inter', 'banco inter'],
  '104': ['caixa', 'cef'],
  '212': ['original'],
  '237': ['bradesco'],
  '260': ['nubank', 'nu pagamentos'],
  '290': ['pagbank', 'pagseguro'],
  '336': ['c6', 'c6 bank'],
  '341': ['itau', 'itaú'],
  '380': ['pagbank'],
};

function normalizeBankId(bankId: string | null): string {
  if (!bankId) return '';
  const stripped = bankId.trim().replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tenta casar o BANKID do OFX com uma conta corrente cadastrada (por nome
 *  do banco/conta); se não achar e houver exatamente UMA conta elegível,
 *  usa essa como padrão. Caso contrário devolve '' (seleção manual). */
function matchOfxAccountName(bankId: string | null, candidates: Account[]): string {
  const hints = OFX_BANK_HINTS[normalizeBankId(bankId)];
  if (hints && hints.length > 0) {
    const found = candidates.find((a) => {
      // Padding com espaços nas bordas para hints curtos (" bb ") baterem
      // mesmo quando o token aparece no início/fim do texto concatenado.
      const hay = stripAccents(` ${a.bank} ${a.name} `.toLowerCase());
      return hints.some((h) => hay.includes(stripAccents(h)));
    });
    if (found) return found.name;
  }
  return candidates.length === 1 ? candidates[0].name : '';
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
  matchCategory?: (description: string) => string | null;
  onCreateRule?: (description: string, categoryId: string) => void;
  rules?: CategoryRule[];
  projects?: Project[];
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

export function ImportModal({ existingTransactions, onImport, onClose, accountNames = [], accounts = [], categories = [], allTitulars = [], titularNames = [], matchCategory, onCreateRule, rules = [], projects = [] }: Props) {
  const [items, setItems] = useState<ImportRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiUsage, setAiUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);

  // Qual caminho de parse gerou as linhas atuais — governa quais painéis do
  // preview aparecem (fatura de cartão vs. extrato de conta corrente OFX).
  const [importKind, setImportKind] = useState<'ai' | 'ofx'>('ai');
  const [ofxParsing, setOfxParsing] = useState(false);
  const [ofxMeta, setOfxMeta] = useState<OfxParseMeta | null>(null);

  // Credit card billing month (= mês de PAGAMENTO/vencimento da fatura, regime
  // de caixa) e o dia de vencimento aplicado (override do cadastro do cartão).
  const [isCreditCard, setIsCreditCard] = useState(false);
  const [billingMonth, setBillingMonth] = useState('');
  const [billingDueDay, setBillingDueDay] = useState('');
  // Total-a-pagar declarado na fatura (lido pelo parser) — valida o total
  // importado contra a fatura (pega pagamento fantasma / linhas perdidas).
  const [declaredTotal, setDeclaredTotal] = useState<number | null>(null);
  const monthOptions = generateMonthOptions();
  const creditCardAccounts = accounts.filter((a) => a.type === 'cartao');
  // Contas elegíveis pra extrato de conta corrente (OFX): tudo que NÃO é
  // cartão. No modo OFX SÓ essas podem ser destino — nunca cair pra
  // `accountNames` cru (que inclui cartões): extrato de conta corrente jamais
  // deve ser lançado num cartão. Se não houver nenhuma conta elegível, a lista
  // fica VAZIA (o banner "cadastre uma conta corrente" cobre esse caso).
  const ofxEligibleAccounts = accounts.filter((a) => a.type !== 'cartao');
  const rowAccountNames = importKind === 'ofx'
    ? ofxEligibleAccounts.map((a) => a.name)
    : accountNames;

  // Batch assignment controls
  const [batchAccount, setBatchAccount] = useState('');
  const [batchCategory, setBatchCategory] = useState('');
  const [batchMember, setBatchMember] = useState('');
  const [batchProject, setBatchProject] = useState('');

  // Installment editor (position tracked for fixed popup outside overflow container)
  const [editingInstallment, setEditingInstallment] = useState<number | null>(null);
  const [installmentPopupPos, setInstallmentPopupPos] = useState<{ top: number; left: number } | null>(null);

  // Member options: only from titular mappings (registered members)
  const memberOptions = titularNames.length > 0 ? titularNames : allTitulars;

  // Cartão-alvo do lote (para o dia de vencimento padrão): com um único cartão,
  // é ele; com vários, o cartão (type cartao) mais frequente entre as linhas.
  const billingCardAccount = (() => {
    if (creditCardAccounts.length === 1) return creditCardAccounts[0];
    const counts = new Map<string, number>();
    for (const it of items) {
      if (it.account) counts.set(it.account, (counts.get(it.account) || 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [name, n] of counts) if (n > bestN) { bestN = n; best = name; }
    return creditCardAccounts.find((a) => a.name === best) || null;
  })();

  // Dia de vencimento efetivo: override digitado no import > dia cadastrado no
  // cartão. É o DIA da data de caixa; o MÊS vem do seletor de pagamento.
  const effectiveDueDay: number | null = (() => {
    const override = parseInt(billingDueDay, 10);
    if (billingDueDay.trim() !== '' && Number.isFinite(override)) return override;
    return billingCardAccount?.dueDay ?? null;
  })();

  // Data de caixa que TODOS os lançamentos da fatura receberão (dia de
  // vencimento do mês de pagamento escolhido). Espelha exatamente o cálculo do
  // handleImport, para o texto de confirmação bater com o que será gravado.
  const resolvedInvoiceDate = isCreditCard ? invoiceDateFor(billingMonth, effectiveDueDay) : null;

  // Pré-preenche "Vence dia:" com o dueDay do cartão RESOLVIDO da importação
  // (billingCardAccount) assim que ele fica disponível — não só no caso de um
  // único cartão cadastrado. billingCardAccount só se resolve corretamente com
  // vários cartões depois que as linhas têm `account` = o cartão certo (auto
  // no caso de 1 cartão; via "Aplicar em lote" no caso de vários) — o efeito
  // reage a essa mudança. Só toca o campo enquanto o usuário não digitou nada,
  // para nunca sobrescrever um override manual.
  useEffect(() => {
    if (billingDueDay.trim() !== '') return;
    if (billingCardAccount?.dueDay) setBillingDueDay(String(billingCardAccount.dueDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingCardAccount?.dueDay]);

  // Rótulos do placar: cartão fala em Compras/Estornos; conta corrente (OFX)
  // fala em Saídas/Entradas — positivos ali são receitas, não estornos.
  const scoreLabels = isCreditCard
    ? { neg: 'Compras', pos: 'Estornos/créditos', net: 'Líquido do mês' }
    : { neg: 'Saídas', pos: 'Entradas', net: 'Líquido' };

  // ─── Roteamento por formato ─────────────────────────────────────────────────
  //
  // .ofx/.ofc → parser determinístico (parseOfx), sem IA, conta corrente.
  // Todo o resto (.csv/.xlsx/.xls/.pdf) → caminho de IA existente, intacto.
  function routeFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'ofx' || ext === 'ofc') {
      handleParseOfx(file);
    } else {
      handleParse(file);
    }
  }

  // ─── Parse via OFX (determinístico, sem IA) ────────────────────────────────

  async function handleParseOfx(file: File) {
    setError('');
    setFileName(file.name);
    setDeclaredTotal(null);
    setAiUsage(null);
    setImportKind('ofx');
    setIsCreditCard(false);

    // Teto de tamanho: extrato OFX real nunca passa de alguns MB (é texto puro).
    // Rejeita antes de ler os bytes na memória — blinda tanto o clique quanto o
    // drop, que passam ambos por aqui. Evita travar a aba com um arquivo
    // gigante (acidental ou malicioso) chegando no TextDecoder.
    if (file.size > OFX_MAX_BYTES) {
      setError(
        `Arquivo grande demais (${(file.size / 1_000_000).toFixed(1)} MB). ` +
        `Um extrato OFX de conta corrente não passa de ${OFX_MAX_BYTES / 1_000_000} MB — verifique se o arquivo está correto.`
      );
      return;
    }

    setOfxParsing(true);

    try {
      // OFX declara CHARSET:1252 (Windows-1252/Latin-1), NÃO UTF-8 — ler como
      // UTF-8 quebra os acentos do MEMO silenciosamente (mojibake). Ver nota
      // de encoding no topo de `src/lib/parseOfx.ts`.
      const buf = await file.arrayBuffer();
      const text = new TextDecoder('windows-1252').decode(buf);
      const result = parseOfx(text);

      if (result.transactions.length === 0) {
        setError(
          result.meta.warnings[0] ||
          'Nenhuma transação encontrada no arquivo OFX. Verifique se é um extrato de conta corrente válido.'
        );
        setOfxParsing(false);
        return;
      }

      const defaultAccountName = matchOfxAccountName(result.account.bankId, ofxEligibleAccounts);

      const parsed: ImportRow[] = result.transactions.map((t) => {
        const item: ImportItem = {
          date: t.date,
          purchaseDate: null,
          description: t.description,
          amount: t.amount,
          categoryId: null,
          account: defaultAccountName,
          familyMember: '',
          titular: '',
          installmentNumber: null,
          totalInstallments: null,
          cardNumber: null,
          projectId: null,
          fitid: t.fitid,
          tags: [],
          notes: '',
          importBatch: null,
          reconciled: false,
          reconciledAt: null,
        };
        return {
          ...item,
          isDuplicate: isOfxDuplicate(item, existingTransactions),
          installmentType: 'unica' as const,
          periodicity: 1,
          installmentAmount: null,
        };
      });

      setOfxMeta(result.meta);
      setItems(parsed);
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i].isDuplicate)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo OFX');
    }
    setOfxParsing(false);
  }

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

      /** Sort items top-to-bottom then left-to-right and join into lines */
      const buildColumnText = (items: { x: number; y: number; text: string }[]) => {
        const lineMap = new Map<number, { x: number; text: string }[]>();
        for (const item of items) {
          if (!lineMap.has(item.y)) lineMap.set(item.y, []);
          lineMap.get(item.y)!.push({ x: item.x, text: item.text });
        }
        return Array.from(lineMap.entries())
          .sort((a, b) => b[0] - a[0]) // descending Y = top-to-bottom in PDF coords
          .map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.text).join(' '))
          .join('\n');
      };

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const pageWidth = viewport.width;
        const content = await page.getTextContent();

        // Collect all positioned text items
        const allItems: { x: number; y: number; text: string }[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          allItems.push({
            x: item.transform[4],
            y: Math.round(item.transform[5] / 3) * 3,
            text: item.str,
          });
        }
        if (allItems.length === 0) continue;

        // ── Two-column detection ───────────────────────────────────────────────
        // Strategy: find the X position of the leftmost item on each line, then
        // look for the largest gap between those "line-start" X values within the
        // central 60% of the page (20–80%). Two columns produce a large gap
        // between the left-column starts (~50pt) and right-column starts (~300pt).
        // This is far more reliable than checking zone counts, because it is not
        // fooled by text that extends across the page (amounts, headers, etc.).

        // Step 1 – leftmost X per Y level
        const lineStartX = new Map<number, number>(); // y → min(x)
        for (const item of allItems) {
          const cur = lineStartX.get(item.y);
          if (cur === undefined || item.x < cur) lineStartX.set(item.y, item.x);
        }
        const startXs = Array.from(lineStartX.values()).sort((a, b) => a - b);

        // Step 2 – find the largest gap in start-X values within the central page
        let maxGap = 0;
        let splitX = pageWidth / 2;
        for (let i = 0; i < startXs.length - 1; i++) {
          const gap = startXs[i + 1] - startXs[i];
          const mid = (startXs[i] + startXs[i + 1]) / 2;
          // Only consider gaps in the central 60% of the page (avoids margins)
          if (mid >= pageWidth * 0.20 && mid <= pageWidth * 0.80 && gap > maxGap) {
            maxGap = gap;
            splitX = mid; // midpoint of the gap is the column boundary
          }
        }

        // Step 3 – require the gap to be at least 18% of page width AND
        // both sides must have several lines to avoid false positives
        const leftLines = startXs.filter((x) => x < splitX).length;
        const rightLines = startXs.filter((x) => x >= splitX).length;
        const isTwoColumn = maxGap >= pageWidth * 0.18 && leftLines >= 3 && rightLines >= 3;

        console.log(
          `[PDF p${p}] pageWidth=${pageWidth.toFixed(0)} maxGap=${maxGap.toFixed(0)} ` +
          `splitX=${splitX.toFixed(0)} leftLines=${leftLines} rightLines=${rightLines} ` +
          `isTwoColumn=${isTwoColumn}`
        );

        if (isTwoColumn) {
          const leftItems = allItems.filter((i) => i.x < splitX);
          const rightItems = allItems.filter((i) => i.x >= splitX);

          // Emit left column first (top-to-bottom), then mark the column break,
          // then emit right column (top-to-bottom).
          // The [COLUNA-DIREITA] marker signals to the AI that this is a layout
          // break — the active cardholder section continues unless an explicit
          // cardholder name header appears right after the marker.
          text += buildColumnText(leftItems) + '\n';
          text += '[COLUNA-DIREITA]\n';
          text += buildColumnText(rightItems) + '\n\n';
        } else {
          text += buildColumnText(allItems) + '\n\n';
        }
      }

      if (text.trim().length < 100) {
        text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          text += content.items.filter((i) => 'str' in i).map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
        }
      }
      console.log('[PDF extract] chars:', text.length, '| preview:', text.slice(0, 500));
      return text;
    }

    throw new Error('Formato nao suportado. Use .xlsx, .xls, .csv ou .pdf');
  }

  // ─── Parse via AI ───────────────────────────────────────────────────────────

  async function handleParse(file: File) {
    setError('');
    setFileName(file.name);
    setDeclaredTotal(null);
    setImportKind('ai');
    setOfxMeta(null);
    setAiParsing(true);

    try {
      const rawText = await extractRawText(file);

      if (rawText.trim().length < 50) {
        setError('Nao foi possivel extrair dados do arquivo. Se for PDF escaneado, use Excel/CSV.');
        setAiParsing(false);
        return;
      }

      const localKey = localStorage.getItem('anthropic_api_key') || '';
      if (!localKey) {
        setError('Chave API nao configurada. Va em Configuracoes > Chave API e insira sua chave Anthropic.');
        setAiParsing(false);
        return;
      }
      const response = await fetch('/api/parse-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, fileName: file.name, apiKey: localKey }),
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
        declaredTotal?: number | null;
        usage: { input_tokens: number; output_tokens: number };
      };

      setAiUsage(data.usage);
      setDeclaredTotal(data.declaredTotal ?? null);

      // Detect credit card: AI flag or heuristic (most transactions have cardNumber)
      const hasCardNumbers = data.transactions.filter((t) => t.cardNumber).length > data.transactions.length / 2;
      const detectedCreditCard = !!data.isCreditCard || hasCardNumbers;
      setIsCreditCard(detectedCreditCard);

      const parsed: ImportRow[] = data.transactions.map((t) => {
        // Post-process: spreadsheet rows often glue the parcel marker at the end
        // of the description (e.g. "DA CAPO       02/02" or "MERCA05/05"). When
        // the AI missed it, extract it ourselves; in any case strip the trailing
        // marker so descriptions are clean and duplicates match across imports.
        const extracted = extractTrailingInstallment(t.description);
        const cleanDescription = (extracted ? extracted.description : (t.description || ''))
          .replace(/\s+/g, ' ')
          .trim();
        const installmentNumber = t.installmentNumber ?? extracted?.installmentNumber ?? null;
        const totalInstallments = t.totalInstallments ?? extracted?.totalInstallments ?? null;
        // True when the parcel came from our regex rather than the AI —
        // these rows are already one-row-per-parcel-occurrence, so we must
        // NOT auto-expand them into future installments.
        const installmentFromDescription = extracted !== null && t.totalInstallments == null;

        const date = new Date(t.date + 'T12:00:00');
        const matchedMember = fuzzyMatchMember(t.titular || '', memberOptions);
        const hasInstallments = totalInstallments != null && totalInstallments > 1;
        const item: ImportItem = {
          date,
          purchaseDate: t.purchaseDate ? new Date(t.purchaseDate + 'T12:00:00') : null,
          description: cleanDescription,
          amount: t.amount,
          categoryId: matchCategory ? matchCategory(cleanDescription) : null,
          account: accountNames[0] ?? '',
          familyMember: matchedMember,
          // Use canonical member name as titular when matched; otherwise normalize to Title Case.
          // This prevents duplicates in the titular filter when the same person's name
          // appears in slightly different formats across different PDF imports.
          titular: matchedMember || normalizeTitular(t.titular || ''),
          installmentNumber,
          totalInstallments,
          cardNumber: t.cardNumber,
          projectId: null,
          tags: [],
          notes: '',
          importBatch: null,
          reconciled: false,
          reconciledAt: null,
        };
        return {
          ...item,
          isDuplicate: isDuplicate(item, existingTransactions),
          // Only auto-expand future installments for bank statements where the AI
          // itself identified the parcel. Credit card imports and parcels that we
          // recovered from a trailing marker in the description are already
          // one-row-per-occurrence and must stay as 'unica' to avoid creating
          // phantom future transactions on every re-import.
          installmentType:
            hasInstallments && !detectedCreditCard && !installmentFromDescription
              ? ('parcelada' as const)
              : ('unica' as const),
          periodicity: 1,
          installmentAmount: hasInstallments ? t.amount : null,
        };
      });

      if (parsed.length === 0) {
        setError(`A IA nao encontrou transacoes no arquivo (${rawText.length} chars extraidos). Verifique o DevTools > Console para ver o texto extraido.`);
        setAiParsing(false);
        return;
      }

      // Sem sugestão de categoria por IA — o que as regras não categorizaram
      // fica sem categoria, para o usuário categorizar manualmente (e as
      // regras aprenderem disso).

      // Auto-detect billing month from the MOST RECENT transaction date — o mês
      // de pagamento nunca pode ficar anterior à última compra da fatura. (Antes
      // usava o mês mais FREQUENTE, o que sugeria um mês passado quando a
      // maioria das compras caía no mês anterior ao fechamento.)
      if (detectedCreditCard && parsed.length > 0) {
        // Ignora datas inválidas (Invalid Date) — senão getMonthYear devolveria
        // "NaN-NaN" e envenenaria o seletor de mês de pagamento.
        const validDates = parsed
          .map((p) => p.date)
          .filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()));
        if (validDates.length > 0) {
          const latestDate = validDates.reduce((latest, d) => (d > latest ? d : latest), validDates[0]);
          setBillingMonth(getMonthYear(latestDate));
        }

        // Auto-select credit card account if only one exists. O pré-preenchimento
        // de "Vence dia:" acontece no efeito acima (reage a billingCardAccount),
        // não aqui — cobre igualmente o caso de vários cartões.
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
        // Aplicar membro em lote também sincroniza o titular canônico.
        ...(batchMember ? { familyMember: batchMember, titular: batchMember } : {}),
        ...(batchProject ? { projectId: batchProject } : {}),
      };
    }));
    setBatchAccount(''); setBatchCategory(''); setBatchMember(''); setBatchProject('');
  }

  function updateRow(index: number, field: keyof ImportItem, value: string) {
    // Keep string fields as empty string, only use null for ID fields like categoryId
    const nullableFields: (keyof ImportItem)[] = ['categoryId', 'projectId'];
    const finalValue = nullableFields.includes(field) ? (value || null) : value;
    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      // Ao escolher o membro, mantemos o `titular` em sincronia com o membro
      // canônico (ou vazio p/ "sem membro"). Sem isso, a string crua do extrato
      // continuaria gravada no titular mesmo com o membro corrigido — a raiz das
      // duplicatas de titular.
      if (field === 'familyMember') {
        return { ...item, familyMember: value, titular: value };
      }
      return { ...item, [field]: finalValue };
    }));
  }

  function updateInstallmentConfig(index: number, updates: Partial<ImportRow>) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) routeFile(file);
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
    // Trava dura: nenhum lançamento entra com titular cru não-vinculado. Se
    // sobrou algum não-resolvido entre os selecionados, aborta e sinaliza (o
    // botão já fica desabilitado; isto é a rede de segurança).
    if (hasUnresolved) {
      setError('Há lançamentos com titular não reconhecido. Escolha um membro cadastrado ou marque "Sem membro" antes de importar.');
      return;
    }
    setError('');
    setImporting(true);
    const toImport: ImportItem[] = [];

    // Data de caixa da fatura: DIA = vencimento (cadastro do cartão ou override
    // no import); MÊS = o mês de pagamento escolhido no seletor. Sob regime de
    // caixa, essa `date` GOVERNA o mês do lançamento (quando o dinheiro sai),
    // inclusive quando a fatura fecha num mês e vence no seguinte. Sem dia de
    // vencimento, cai no dia 1º (retrocompatível). invoiceDateFor trava o dia
    // dentro do mês, então o mês do lançamento é sempre o do seletor.
    let billingDate: Date | null = null;
    if (isCreditCard && billingMonth) {
      billingDate = invoiceDateFor(billingMonth, effectiveDueDay);
    }

    for (const [i, row] of items.entries()) {
      if (!selected.has(i)) continue;
      const { isDuplicate: _, installmentType, periodicity, installmentAmount, ...rest } = row;

      // `purchaseDate` = competência (data da compra original, também de cada
      // parcela) — referência secundária, NÃO governa o mês. `invoiceDate` = a
      // data de caixa (pagamento/vencimento) que vira o `date` e governa o mês.
      // Numa fatura de cartão as parcelas são gravadas como 'unica' e recebem o
      // vencimento desta fatura — ou seja, cada parcela cai no mês em que é PAGA,
      // não no mês da compra. Cada fatura mensal é importada com seu vencimento.
      const purchaseDate = rest.purchaseDate || rest.date;
      const invoiceDate = billingDate || rest.date;

      // Vínculo ciclo↔transação (T1/T3): gravado só no fluxo de cartão
      // (billingDate não-nulo). `billingMonth` é o mês da fatura a que a linha
      // pertence — para a parcela corrente é o mês selecionado; para parcelas
      // futuras é o mês projetado de cada uma. `provisionalDate` é a data de
      // caixa no momento da importação (a "provisória"), preservada intacta
      // quando a baixa da fatura sobrescrever `date` — é o que o reopen (T3)
      // usa para restaurar. Fora do fluxo de cartão os dois ficam ausentes.
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
          billingMonth: billingDate ? billingMonth : rest.billingMonth,
          provisionalDate: billingDate ? invoiceDate : rest.provisionalDate,
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
            billingMonth: billingDate ? getMonthYear(futureDate) : rest.billingMonth,
            provisionalDate: billingDate ? futureDate : rest.provisionalDate,
          });
        }
      } else {
        toImport.push({
          ...rest,
          date: invoiceDate,
          purchaseDate,
          billingMonth: billingDate ? billingMonth : rest.billingMonth,
          provisionalDate: billingDate ? invoiceDate : rest.provisionalDate,
        });
      }
    }

    await onImport(toImport);
    setStep('done');
    setImporting(false);
  }

  const duplicateCount = items.filter((i) => i.isDuplicate).length;

  // Placar do lote: soma das linhas SELECIONADAS (as que serão gravadas, já que
  // as duplicatas entram desmarcadas). Compras = Σ negativos; Estornos/créditos
  // = Σ positivos; Líquido = o que sai no fluxo de caixa do mês. Um total de
  // estornos alto (ex.: pagamento da fatura anterior lido por engano) fica
  // visível ANTES de importar.
  const totals = useMemo(() => {
    let compras = 0;
    let estornos = 0;
    items.forEach((it, i) => {
      if (!selected.has(i)) return;
      if (it.amount < 0) compras += it.amount;
      else estornos += it.amount;
    });
    return { compras, estornos, liquido: compras + estornos };
  }, [items, selected]);

  // Blindagem anti-titular-cru: uma linha SELECIONADA está "não resolvida"
  // quando carrega um titular vindo do extrato (string bruta) que NÃO é um
  // membro cadastrado. fuzzyMatchMember já normaliza os que reconhece (titular =
  // nome canônico ∈ memberOptions); o que sobra é justamente o que criaria
  // titulares duplicados. Só vale quando existe lista de membros p/ escolher —
  // sem membros cadastrados não há o que deduplicar e o gate ficaria impossível.
  const memberSet = useMemo(() => new Set(memberOptions), [memberOptions]);
  const unresolvedIndices = useMemo(() => {
    if (memberOptions.length === 0) return [] as number[];
    const out: number[] = [];
    items.forEach((it, i) => {
      if (!selected.has(i)) return;
      const t = (it.titular || '').trim();
      if (t && !memberSet.has(t)) out.push(i);
    });
    return out;
  }, [items, selected, memberSet, memberOptions.length]);
  const hasUnresolved = unresolvedIndices.length > 0;
  const unresolvedSet = useMemo(() => new Set(unresolvedIndices), [unresolvedIndices]);

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
              {(aiParsing || ofxParsing) ? (
                <div className="border-2 border-dashed border-accent rounded-lg p-12 text-center">
                  <Sparkles size={32} className="mx-auto mb-3 text-accent animate-pulse" />
                  <p className="text-sm text-text-primary mb-1">
                    {ofxParsing ? 'Lendo extrato OFX...' : 'Analisando extrato com IA...'}
                  </p>
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
                    input.accept = '.xlsx,.xls,.csv,.pdf,.ofx,.ofc';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) routeFile(file);
                    };
                    input.click();
                  }}
                >
                  <Sparkles size={32} className="mx-auto mb-3 text-accent" />
                  <p className="text-sm font-bold text-text-primary mb-1">Arrastar arquivo ou clicar</p>
                  <p className="text-xs text-text-secondary mb-3">Extrato de conta corrente (.ofx) entra sem IA · fatura de cartão a IA detecta transacoes, parcelas, titulares e categorias</p>
                  <p className="text-[10px] text-text-secondary">.ofx .ofc .xlsx .xls .csv .pdf</p>
                </div>
              )}
              {error && <p role="alert" className="text-accent-red text-xs mt-3">{error}</p>}
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
                    <span className="flex items-center gap-1 text-xs text-status-warn">
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

              {/* Placar do lote — confere antes de gravar (soma das selecionadas).
                  role=status + aria-live: o leitor de tela anuncia a mudança
                  quando linhas são (des)marcadas (WCAG 4.1.3). */}
              <div className="flex items-center gap-2 flex-wrap text-xs" role="status" aria-live="polite" aria-atomic="true">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-secondary border border-border rounded">
                  <span className="text-text-secondary">{scoreLabels.neg}</span>
                  <span className="font-bold text-accent-red tnum">{formatBRL(totals.compras)}</span>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border ${totals.estornos > 0 ? 'bg-accent-green/10 border-accent-green/40' : 'bg-bg-secondary border-border'}`}>
                  {totals.estornos > 0 && <AlertTriangle size={12} className="text-accent-green shrink-0" />}
                  <span className="text-text-secondary">{scoreLabels.pos}</span>
                  <span className="font-bold text-accent-green tnum">{formatBRL(totals.estornos)}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-card border border-accent/40 rounded">
                  <span className="text-text-secondary">{scoreLabels.net}</span>
                  <span className={`font-bold tnum ${totals.liquido < 0 ? 'text-accent-red' : 'text-accent-green'}`}>{formatBRL(totals.liquido)}</span>
                </div>
                {/* Validação de total: confronta o líquido lido com o total-a-pagar
                    declarado na fatura. Divergência > R$1 acende alerta (pega
                    pagamento fantasma, linhas perdidas, duplicata desmarcada). */}
                {declaredTotal != null && (() => {
                  const declared = Math.abs(declaredTotal);
                  const diff = Math.abs(declared - Math.abs(totals.liquido));
                  const mismatch = diff > 1;
                  return (
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border ${mismatch ? 'bg-accent-red/10 border-accent-red/50' : 'bg-accent-green/10 border-accent-green/40'}`}>
                      {mismatch ? <AlertTriangle size={12} className="text-accent-red shrink-0" /> : <Check size={12} className="text-accent-green shrink-0" />}
                      <span className="text-text-secondary">Declarado</span>
                      <span className={`font-bold tnum ${mismatch ? 'text-accent-red' : 'text-accent-green'}`}>{formatBRL(declared)}</span>
                      {mismatch && <span className="text-[10px] text-accent-red whitespace-nowrap">dif. {formatBRL(diff)}</span>}
                    </div>
                  );
                })()}
                <span className="text-[10px] text-text-secondary">
                  {selected.size} de {items.length} selecionada{items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Credit card billing month = mês de PAGAMENTO/vencimento (caixa) */}
              {isCreditCard && (
                <div className="bg-accent/5 border border-accent/30 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CreditCard size={16} className="text-accent" />
                    <span className="text-xs font-bold text-text-primary">Fatura de cartao detectada</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="billing-month" className="text-xs text-text-secondary whitespace-nowrap">Mês de pagamento:</label>
                    <select
                      id="billing-month"
                      value={billingMonth}
                      onChange={(e) => setBillingMonth(e.target.value)}
                      className={inputClass + ' !w-auto font-bold !text-text-primary'}
                    >
                      {monthOptions.map((m) => (
                        <option key={m} value={m}>{getMonthLabel(m)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="billing-dueday" className="text-xs text-text-secondary whitespace-nowrap">Vence dia:</label>
                    <input
                      id="billing-dueday"
                      type="number"
                      min={1}
                      max={31}
                      value={billingDueDay}
                      onChange={(e) => setBillingDueDay(e.target.value)}
                      placeholder={billingCardAccount?.dueDay ? String(billingCardAccount.dueDay) : '1'}
                      className={inputClass + ' !w-16'}
                    />
                  </div>
                  {/* Confirmação explícita da data de caixa que TODAS as linhas
                      recebem — evita o tropeço de achar que forçou um mês e não
                      forçou (A1), e deixa claro que o mês = pagamento (caixa). */}
                  {resolvedInvoiceDate && (
                    <p aria-live="polite" className="w-full text-[11px] text-text-secondary flex items-start gap-1.5 pt-1 border-t border-accent/15">
                      <CalendarClock size={13} className="text-accent shrink-0 mt-0.5" />
                      <span>
                        As {selected.size} transações selecionadas entram no fluxo de caixa em{' '}
                        <b className="text-text-primary">{formatDate(resolvedInvoiceDate)}</b>{' '}
                        (pagamento da fatura de <b className="text-text-primary">{getMonthLabel(billingMonth)}</b>) — é o mês em que esses gastos contam.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Fim do fallback silencioso pro dia 1º: quando não há dia de
                  vencimento resolvido (nem cadastrado no cartão, nem digitado
                  acima), avisa em destaque em vez de só um texto cinza discreto. */}
              {isCreditCard && billingMonth && !effectiveDueDay && (
                <div role="alert" className="bg-status-warn/10 border border-status-warn/40 rounded-lg p-3 flex items-start gap-2.5">
                  <AlertTriangle size={16} className="text-status-warn shrink-0 mt-0.5" />
                  <div className="text-xs text-text-primary leading-relaxed">
                    <p className="font-bold text-status-warn">Sem dia de vencimento — as transações cairão no dia 1º</p>
                    <p className="text-text-secondary mt-0.5">
                      Cadastre o vencimento deste cartão em <b className="text-text-primary">Configurações</b>, ou
                      informe o dia acima em <b className="text-text-primary">"Vence dia:"</b>, antes de importar.
                    </p>
                  </div>
                </div>
              )}

              {/* Extrato OFX de conta corrente: sem mês de fatura/vencimento
                  (data já vem de DTPOSTED) e sem trava de titular (fica em
                  branco por padrão) — só um resumo do parse + escolha de
                  conta (reaproveita o seletor "Aplicar em lote" abaixo). */}
              {importKind === 'ofx' && ofxMeta && (
                <div className="bg-accent/5 border border-accent/30 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Landmark size={16} className="text-accent" />
                    <span className="text-xs font-bold text-text-primary">Extrato OFX (conta corrente)</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">
                    {ofxMeta.parsedCount} lançamento{ofxMeta.parsedCount !== 1 ? 's' : ''}
                    {ofxMeta.dtStart && ofxMeta.dtEnd && (
                      <> · período {formatDate(ofxMeta.dtStart)}–{formatDate(ofxMeta.dtEnd)}</>
                    )}
                    {ofxMeta.duplicatesInFile > 0 && (
                      <> · {ofxMeta.duplicatesInFile} duplicado{ofxMeta.duplicatesInFile !== 1 ? 's' : ''} ignorado{ofxMeta.duplicatesInFile !== 1 ? 's' : ''} no arquivo</>
                    )}
                  </p>
                  {rowAccountNames.length === 0 && (
                    <span className="w-full text-[11px] text-status-warn">
                      Nenhuma conta corrente cadastrada — cadastre uma em Configurações antes de importar.
                    </span>
                  )}
                </div>
              )}

              {/* Warnings do parser OFX (FITID ausente, TRNTYPE divergente,
                  linhas descartadas) — informativo, não bloqueia a importação. */}
              {importKind === 'ofx' && ofxMeta && ofxMeta.warnings.length > 0 && (
                <div className="bg-status-warn/10 border border-status-warn/30 rounded-lg p-3 space-y-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-status-warn">
                    <AlertTriangle size={12} className="shrink-0" />
                    Avisos do parser OFX ({ofxMeta.warnings.length})
                  </p>
                  <div
                    role="status"
                    tabIndex={0}
                    aria-label={`Avisos do parser OFX: ${ofxMeta.warnings.length} ${ofxMeta.warnings.length === 1 ? 'aviso' : 'avisos'}. Role para ver todos.`}
                    className="text-[11px] text-text-secondary space-y-0.5 max-h-24 overflow-y-auto focus:outline-none focus:ring-1 focus:ring-status-warn/60 rounded"
                  >
                    {ofxMeta.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                </div>
              )}

              {/* Batch controls */}
              <div className="bg-bg-secondary border border-border rounded-lg p-3">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Aplicar em lote nas selecionadas</p>
                <div className="flex gap-2 flex-wrap items-end">
                  {rowAccountNames.length > 0 && (
                    <div className="flex-1 min-w-[140px]">
                      <label htmlFor="batch-account" className="block text-[10px] text-text-secondary mb-1">Conta</label>
                      <select id="batch-account" value={batchAccount} onChange={(e) => setBatchAccount(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {rowAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}
                  {categories.length > 0 && (
                    <div className="flex-1 min-w-[140px]">
                      <label htmlFor="batch-category" className="block text-[10px] text-text-secondary mb-1">Categoria</label>
                      <select id="batch-category" value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {rootCats.map((cat) => {
                          const subs = subCats(cat.id);
                          return (
                            <optgroup key={cat.id} label={cat.name}>
                              <option value={cat.id}>{cat.name}</option>
                              {subs.map((s) => <option key={s.id} value={s.id}>  ↳ {s.name}</option>)}
                            </optgroup>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  {memberOptions.length > 0 && (
                    <div className="flex-1 min-w-[120px]">
                      <label htmlFor="batch-member" className="block text-[10px] text-text-secondary mb-1">Membro</label>
                      <select id="batch-member" value={batchMember} onChange={(e) => setBatchMember(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {memberOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  {projects.length > 0 && (
                    <div className="flex-1 min-w-[120px]">
                      <label htmlFor="batch-project" className="block text-[10px] text-text-secondary mb-1">Projeto</label>
                      <select id="batch-project" value={batchProject} onChange={(e) => setBatchProject(e.target.value)} className={inputClass}>
                        <option value="">— sem alterar —</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={applyBatch}
                    disabled={!batchAccount && !batchCategory && !batchMember && !batchProject}
                    className="px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
                  >
                    <Check size={12} /> Aplicar
                  </button>
                </div>
              </div>

              {/* Blindagem de titular: aviso quando há lançamentos com titular
                  cru não vinculado a um membro cadastrado. */}
              {hasUnresolved && (
                <div role="alert" className="bg-status-warn/10 border border-status-warn/40 rounded-lg p-3 flex items-start gap-2.5">
                  <UserX size={16} className="text-status-warn shrink-0 mt-0.5" />
                  <div className="text-xs text-text-primary leading-relaxed">
                    <p className="font-bold text-status-warn">
                      {unresolvedIndices.length} lançamento{unresolvedIndices.length > 1 ? 's' : ''} com titular não reconhecido
                    </p>
                    <p className="text-text-secondary mt-0.5">
                      Na coluna <b className="text-text-primary">Membro</b> (destacada), escolha um membro cadastrado
                      ou marque <b className="text-text-primary">“Sem membro”</b>. Isso evita criar titulares duplicados —
                      a importação só conclui quando todos estiverem resolvidos.
                    </p>
                  </div>
                </div>
              )}

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
                      <th className="p-2 text-left min-w-[110px]">Conta</th>
                      <th className="p-2 text-left min-w-[120px]">Categoria</th>
                      <th className="p-2 text-left min-w-[100px]">Membro</th>
                      {projects.length > 0 && <th className="p-2 text-left min-w-[100px]">Projeto</th>}
                      <th className="p-2 text-center w-12">Nota</th>
                      <th className="p-2 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr
                        key={i}
                        className={`border-b border-border/40 ${item.isDuplicate ? 'bg-status-warn/5' : ''} ${selected.has(i) ? '' : 'opacity-40'}`}
                      >
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggleItem(i)} className="accent-accent" />
                        </td>
                        <td className="p-1 whitespace-nowrap">
                          <input
                            type="date"
                            value={item.date.toISOString().split('T')[0]}
                            onChange={(e) => {
                              if (e.target.value) {
                                updateInstallmentConfig(i, { date: new Date(e.target.value + 'T12:00:00') });
                              }
                            }}
                            className="px-1 py-0.5 bg-bg-secondary border border-border rounded text-text-secondary text-xs focus:outline-none focus:border-accent w-[110px]"
                          />
                        </td>
                        <td className="p-2 text-text-primary max-w-[180px] truncate" title={item.description}>{item.description}</td>
                        <td className={`p-2 text-right font-bold whitespace-nowrap ${item.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          {formatBRL(item.amount)}
                        </td>
                        <td className="p-1 text-center">
                          {/* Extrato de conta corrente (OFX) já é lançamento
                              efetivado — parcelar não faz sentido e criaria
                              parcelas futuras sintéticas. O editor fica travado
                              no modo OFX (só um "—" estático, sem popup). */}
                          {importKind === 'ofx' ? (
                            <span className="text-text-secondary" title="Parcelamento não se aplica a extrato de conta corrente">—</span>
                          ) : (
                          <button
                            onClick={(e) => {
                              if (editingInstallment === i) {
                                setEditingInstallment(null);
                                setInstallmentPopupPos(null);
                              } else {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const popupH = 380;
                                const popupW = 240;
                                // Always open upward to avoid going below viewport
                                const top = Math.max(8, rect.top - popupH - 4);
                                const left = Math.min(rect.left + rect.width / 2 - popupW / 2, window.innerWidth - popupW - 8);
                                setInstallmentPopupPos({ top, left: Math.max(8, left) });
                                setEditingInstallment(i);
                              }
                            }}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              item.installmentType === 'parcelada'
                                ? 'bg-accent/10 border-accent/30 text-accent'
                                : item.totalInstallments && item.totalInstallments > 1
                                  ? 'bg-accent/10 border-accent/20 text-accent/80'
                                  : 'bg-bg-secondary border-border text-text-secondary hover:border-accent/30'
                            }`}
                          >
                            {item.totalInstallments && item.totalInstallments > 1
                              ? `${item.installmentNumber || 1}/${item.totalInstallments}`
                              : item.installmentType === 'parcelada'
                                ? `${item.installmentNumber || 1}/${item.totalInstallments}`
                                : 'Unica'}
                            <ChevronDown size={10} className="inline ml-1" />
                          </button>
                          )}
                        </td>
                        {/* Editable: account */}
                        <td className="p-1">
                          {rowAccountNames.length > 0 ? (
                            <select
                              aria-label="Conta"
                              value={item.account}
                              onChange={(e) => updateRow(i, 'account', e.target.value)}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {rowAccountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          ) : (
                            <span className="text-text-secondary">{item.account || '—'}</span>
                          )}
                        </td>
                        {/* Editable: category */}
                        <td className="p-1">
                          <div className="flex items-center gap-1">
                            {categories.length > 0 ? (
                              <select
                                aria-label="Categoria"
                                value={item.categoryId ?? ''}
                                onChange={(e) => updateRow(i, 'categoryId', e.target.value)}
                                className={inputClass}
                              >
                                <option value="">—</option>
                                {(() => {
                                  const rel = filterCategoriesByAmount(categories, item.amount);
                                  const roots = rel.filter((c) => !c.parentId);
                                  return roots.map((cat) => {
                                    const subs = rel.filter((c) => c.parentId === cat.id);
                                    return (
                                      <optgroup key={cat.id} label={cat.name}>
                                        <option value={cat.id}>{cat.name}</option>
                                        {subs.map((s) => <option key={s.id} value={s.id}>  ↳ {s.name}</option>)}
                                      </optgroup>
                                    );
                                  });
                                })()}
                              </select>
                            ) : (
                              <span className="text-text-secondary">—</span>
                            )}
                            {item.categoryId && onCreateRule && (() => {
                              const hasRule = rules.some((r) => r.pattern.toLowerCase() === item.description.toLowerCase());
                              return (
                                <button
                                  type="button"
                                  title={hasRule ? 'Remover regra existente' : 'Criar regra para esta descrição'}
                                  onClick={() => onCreateRule(item.description, item.categoryId!)}
                                  className={`flex-shrink-0 transition-colors ${
                                    hasRule
                                      ? 'text-yellow-400 hover:text-yellow-300'
                                      : 'text-text-secondary/30 hover:text-text-secondary'
                                  }`}
                                >
                                  <Zap size={12} />
                                </button>
                              );
                            })()}
                          </div>
                        </td>
                        {/* Editable: family member */}
                        <td className="p-1">
                          {memberOptions.length > 0 ? (
                            (() => {
                              const unresolved = unresolvedSet.has(i);
                              // value: membro casado → nome; "sem membro" explícito
                              // (titular vazio) → sentinela __none__; não resolvido
                              // → placeholder desabilitado "Escolher…".
                              const selVal = memberSet.has(item.familyMember)
                                ? item.familyMember
                                : (unresolved ? '' : '__none__');
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <select
                                    aria-label="Membro"
                                    value={selVal}
                                    onChange={(e) => {
                                      const v = e.target.value === '__none__' ? '' : e.target.value;
                                      updateRow(i, 'familyMember', v);
                                    }}
                                    className={inputClass + (unresolved ? ' !border-status-warn border-2 ring-1 ring-status-warn/40' : '')}
                                  >
                                    <option value="" disabled>Escolher…</option>
                                    {memberOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                                    <option value="__none__">Sem membro</option>
                                  </select>
                                  {unresolved && (
                                    <span className="text-[10px] text-status-warn/90 truncate" title={item.titular}>
                                      extrato: “{item.titular}”
                                    </span>
                                  )}
                                </div>
                              );
                            })()
                          ) : (
                            <span className="text-text-secondary">{item.familyMember || '—'}</span>
                          )}
                        </td>
                        {projects.length > 0 && (
                          <td className="p-1">
                            <select
                              aria-label="Projeto"
                              value={item.projectId ?? ''}
                              onChange={(e) => updateRow(i, 'projectId', e.target.value)}
                              className={inputClass}
                            >
                              <option value="">—</option>
                              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                        )}
                        <td className="p-1 text-center">
                          <div className="flex justify-center group">
                            <NoteTag
                              note={item.notes || ''}
                              onSave={(note) => updateInstallmentConfig(i, { notes: note })}
                            />
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          {item.isDuplicate && (
                            <span title="Possivel duplicata — ja existe transacao com mesma data, valor e descricao">
                              <AlertTriangle size={13} className="text-status-warn" />
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
                    <div className="fixed inset-0 z-[60]" onClick={() => { setEditingInstallment(null); setInstallmentPopupPos(null); }} />
                    <div
                      className="fixed z-[70] bg-bg-card border border-border rounded-lg shadow-lg p-3 w-[240px] max-h-[80vh] overflow-y-auto"
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
            <div className="py-8 space-y-6">
              <div className="text-center">
                <Check size={32} className="mx-auto mb-3 text-accent-green" />
                <p className="text-sm text-text-primary">Importacao concluida!</p>
                <p className="text-xs text-text-secondary mt-1">{selected.size} transacoes importadas</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'preview' && (
          <div className="p-4 border-t border-border flex items-center justify-between gap-3">
            <span className="text-xs text-text-secondary">
              {hasUnresolved ? (
                <span className="flex items-center gap-1.5 text-status-warn">
                  <UserX size={13} /> {unresolvedIndices.length} titular{unresolvedIndices.length > 1 ? 'es' : ''} a resolver
                </span>
              ) : (
                `${selected.size} de ${items.length} selecionadas`
              )}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('upload'); setItems([]); setError(''); setAiUsage(null); setDeclaredTotal(null); setOfxMeta(null); }}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                Voltar
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || importing || hasUnresolved}
                title={hasUnresolved ? 'Resolva os titulares não reconhecidos antes de importar' : undefined}
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
