import { useRef, useState } from 'react';
import { Plus, Trash2, CreditCard, Wallet, Pencil, Check, X, Users, KeyRound, Eye, EyeOff, RefreshCw, Download, Upload, Database, AlertTriangle, UserCheck, FileSpreadsheet } from 'lucide-react';
import { NormalizeTitulars } from './NormalizeTitulars';
import { BackfillInvoiceFields } from './BackfillInvoiceFields';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useAccounts } from '../../hooks/useAccounts';
import { parseMoneyInput, applyMoneyMask } from '../../lib/utils';
import type { Account } from '../../types';
import {
  exportBackup,
  downloadBackup,
  readBackupFile,
  restoreBackup,
  summarizeBackup,
  USER_COLLECTIONS,
  type BackupFile,
} from '../../lib/backup';

const ACCOUNT_TYPES: { value: Account['type']; label: string }[] = [
  { value: 'corrente', label: 'Conta Corrente' },
  { value: 'cartao', label: 'Cartao de Credito' },
  { value: 'beneficio', label: 'Vale alimentação/refeição' },
  { value: 'poupanca', label: 'Poupanca' },
  { value: 'investimento', label: 'Investimento' },
  { value: 'outro', label: 'Outro' },
];

export function SettingsPage() {
  const { mappings, loading, addMapping, deleteMapping } = useTitularMappings();
  const { members, memberNames, loading: loadingMembers, addMember, deleteMember } = useFamilyMembers();
  const { accounts, loading: loadingAccounts, addAccount, updateAccount, deleteAccount } = useAccounts();

  const [anthropicKey, setAnthropicKey] = useState(() => localStorage.getItem('anthropic_api_key') || '');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const [newMemberName, setNewMemberName] = useState('');
  const [cardDigits, setCardDigits] = useState('');
  const [titularName, setTitularName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<Account['type']>('corrente');
  const [accountBank, setAccountBank] = useState('');
  const [accountDueDay, setAccountDueDay] = useState('');
  const [accountCreditLimit, setAccountCreditLimit] = useState('');

  // Edit account fields (nome, tipo, banco + campos de cartão)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<Account['type']>('corrente');
  const [editBank, setEditBank] = useState('');
  const [editDueDay, setEditDueDay] = useState('');
  const [editCreditLimit, setEditCreditLimit] = useState('');

  // Backup / Restore state
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pendingBackup, setPendingBackup] = useState<BackupFile | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleExportBackup() {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const backup = await exportBackup();
      downloadBackup(backup);
      const total = Object.values(backup.collections).reduce((sum, arr) => sum + arr.length, 0);
      setBackupMsg({ type: 'ok', text: `Backup gerado com sucesso (${total} registro(s) em ${USER_COLLECTIONS.length} colecoes).` });
    } catch (err) {
      setBackupMsg({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao gerar backup.' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setBackupMsg(null);
    try {
      const parsed = await readBackupFile(file);
      setPendingBackup(parsed);
    } catch (err) {
      setBackupMsg({ type: 'err', text: err instanceof Error ? err.message : 'Arquivo invalido.' });
    }
  }

  async function handleConfirmRestore() {
    if (!pendingBackup) return;
    setRestoreBusy(true);
    setRestoreProgress('Iniciando...');
    setBackupMsg(null);
    try {
      const result = await restoreBackup(pendingBackup, { wipeExisting: true }, (p) => {
        if (p.phase === 'reading') setRestoreProgress(`Lendo dados atuais (${p.collection})...`);
        else if (p.phase === 'deleting') setRestoreProgress(`Limpando ${p.collection}...`);
        else if (p.phase === 'writing') setRestoreProgress(`Gravando ${p.written}/${p.totalToWrite} registros...`);
        else if (p.phase === 'syncing') setRestoreProgress('Sincronizando com o servidor...');
      });
      const total = Object.values(result.written).reduce((s, n) => s + n, 0);
      const base = `Restauração concluída — ${total} registro(s) gravado(s).`;
      if (result.serverAckComplete && result.failedChunks === 0) {
        setBackupMsg({ type: 'ok', text: `${base} Tudo confirmado no servidor (indicador "Salvo"). Recarregue a página para ver os dados.` });
      } else if (result.serverAckComplete) {
        setBackupMsg({ type: 'err', text: `${base} Atenção: ${result.failedChunks} lote(s) não foram aceitos pelo servidor; verifique os dados antes de fechar.` });
      } else {
        setBackupMsg({ type: 'err', text: `${base} Os dados já estão salvos NESTE aparelho, mas a sincronização com o servidor ainda não terminou. Mantenha o app aberto e conectado e acompanhe o indicador no menu: só feche ou troque de aparelho quando ele estiver verde ("Salvo").` });
      }
      setPendingBackup(null);
    } catch (err) {
      setBackupMsg({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao restaurar backup.' });
    } finally {
      setRestoreBusy(false);
      setRestoreProgress(null);
    }
  }

  function handleCancelRestore() {
    setPendingBackup(null);
    setBackupMsg(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!cardDigits || !titularName) return;
    await addMapping({ cardLastDigits: cardDigits.slice(-4), titularName: titularName.trim() });
    setCardDigits(''); setTitularName('');
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) return;
    const data: Omit<Account, 'id' | 'createdAt'> = {
      name: accountName.trim(),
      type: accountType,
      bank: accountBank.trim(),
    };
    if (accountType === 'cartao') {
      // Dia de fechamento não é mais cadastrado aqui (varia mês a mês; ajuste
      // pontual vai no override do import). Só vencimento + limite.
      if (accountDueDay) data.dueDay = parseInt(accountDueDay);
      // Campo mascarado na entrada; só grava quando há dígito (parseMoneyInput
      // cai em 0 pra texto não numérico, então guardamos contra "-"/lixo).
      if (/\d/.test(accountCreditLimit)) data.creditLimit = parseMoneyInput(accountCreditLimit);
    }
    await addAccount(data);
    setAccountName(''); setAccountType('corrente'); setAccountBank('');
    setAccountDueDay(''); setAccountCreditLimit('');
  }

  function startEditAccount(a: Account) {
    setEditingAccountId(a.id);
    setEditName(a.name);
    setEditType(a.type);
    setEditBank(a.bank || '');
    setEditDueDay(a.dueDay?.toString() || '');
    // Pré-preenche já mascarado (pt-BR) para casar com a máscara ao-vivo do
    // input — 5000 → "5.000,00". toFixed(2) dá as 2 casas que o mask espera.
    setEditCreditLimit(a.creditLimit != null ? applyMoneyMask(a.creditLimit.toFixed(2)) : '');
  }

  async function saveEditAccount(id: string) {
    if (!editName.trim()) return;
    const data: Partial<Account> = {
      name: editName.trim(),
      type: editType,
      bank: editBank.trim() || undefined,
    };
    if (editType === 'cartao') {
      data.dueDay = editDueDay ? parseInt(editDueDay) : undefined;
      // Campo mascarado; grava só com dígito (parseMoneyInput não sinaliza erro).
      data.creditLimit = /\d/.test(editCreditLimit) ? parseMoneyInput(editCreditLimit) : undefined;
    }
    await updateAccount(id, data);
    setEditingAccountId(null);
  }

  if (loading || loadingMembers || loadingAccounts) {
    return <div className="text-accent text-sm animate-pulse">Carregando configuracoes...</div>;
  }

  const inputClass = 'px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-text-primary">Configuracoes</h2>

      {/* Family Members */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Users size={16} className="text-accent" /> Familia
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Cadastre os membros da familia. Esses nomes serao usados no mapeamento de titulares e na atribuicao de transacoes.
          </p>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!newMemberName.trim()) return;
          await addMember(newMemberName);
          setNewMemberName('');
        }} className="flex gap-2 flex-wrap">
          <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
            placeholder="Nome completo do membro" className={`${inputClass} flex-1 min-w-[200px]`} />
          <button type="submit" disabled={!newMemberName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
            <Plus size={14} /> Adicionar
          </button>
        </form>
        {members.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhum membro cadastrado.</p>
        ) : (
          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs">
                <span className="text-text-primary font-bold">{m.name}</span>
                <button onClick={() => deleteMember(m.id)} className="text-text-secondary hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Accounts */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Wallet size={16} className="text-accent" /> Contas e Cartoes
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Cadastre suas contas bancarias e cartoes. Elas aparecerao como opcoes ao registrar transacoes.
          </p>
        </div>
        <form onSubmit={handleAddAccount} className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
              placeholder="Nome (ex: Nubank, Itau CC)" className={`${inputClass} flex-1 min-w-[150px]`} required />
            <select value={accountType} onChange={(e) => setAccountType(e.target.value as Account['type'])} className={`${inputClass} w-44`}>
              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input type="text" value={accountBank} onChange={(e) => setAccountBank(e.target.value)}
              placeholder="Banco (opcional)" className={`${inputClass} w-36`} />
            <button type="submit" disabled={!accountName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
              <Plus size={14} /> Adicionar
            </button>
          </div>
          {accountType === 'cartao' && (
            <div className="pl-1 space-y-1">
              <div className="flex gap-2 flex-wrap">
                <input type="number" value={accountDueDay} onChange={(e) => setAccountDueDay(e.target.value)}
                  placeholder="Dia vencimento" min={1} max={28} className={`${inputClass} w-36`} />
                <input type="text" inputMode="decimal" value={accountCreditLimit} onChange={(e) => setAccountCreditLimit(applyMoneyMask(e.target.value))}
                  placeholder="Limite (R$)" className={`${inputClass} w-36`} />
              </div>
              <p className="text-[10px] text-text-secondary">
                O <b className="text-text-primary">dia de vencimento</b> vira a data dos lançamentos ao importar a fatura — é o dia em que o gasto entra no fluxo de caixa do mês. Não pedimos o dia de fechamento aqui (ele varia mês a mês); ajuste pontual é feito no override durante o import.
              </p>
            </div>
          )}
        </form>
        {accounts.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhuma conta cadastrada.</p>
        ) : (
          <div className="space-y-1">
            {accounts.map((a) => (
              <div key={a.id} className="px-3 py-2 bg-bg-secondary rounded text-xs space-y-1.5">
                {editingAccountId === a.id ? (
                  <div className="space-y-2 py-0.5">
                    <div className="flex gap-2 flex-wrap">
                      <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                        placeholder="Nome" aria-label="Nome da conta" className={`${inputClass} flex-1 min-w-[130px] !py-1 !text-xs`} />
                      <select value={editType} onChange={(e) => setEditType(e.target.value as Account['type'])}
                        aria-label="Tipo da conta" className={`${inputClass} w-44 !py-1 !text-xs`}>
                        {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input type="text" value={editBank} onChange={(e) => setEditBank(e.target.value)}
                        placeholder="Banco (opcional)" aria-label="Banco" className={`${inputClass} w-32 !py-1 !text-xs`} />
                    </div>
                    {editType === 'cartao' && (
                      <div className="flex gap-2 flex-wrap">
                        <input type="number" value={editDueDay} onChange={(e) => setEditDueDay(e.target.value)}
                          placeholder="Dia venc." min={1} max={28} aria-label="Dia de vencimento" className={`${inputClass} w-28 !py-1 !text-xs`} />
                        <input type="text" inputMode="decimal" value={editCreditLimit} onChange={(e) => setEditCreditLimit(applyMoneyMask(e.target.value))}
                          placeholder="Limite (R$)" aria-label="Limite" className={`${inputClass} w-32 !py-1 !text-xs`} />
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <button onClick={() => saveEditAccount(a.id)} disabled={!editName.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 bg-accent text-bg-primary text-[11px] font-bold rounded hover:opacity-90 disabled:opacity-50">
                        <Check size={13} /> Salvar
                      </button>
                      <button onClick={() => setEditingAccountId(null)} className="text-text-secondary hover:text-accent-red p-1" title="Cancelar" aria-label={`Cancelar edição de ${a.name}`}><X size={14} /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      <span className="text-text-primary font-bold">{a.name}</span>
                      <span className="text-[10px] text-text-secondary uppercase">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}</span>
                      {a.bank && <span className="text-text-secondary">({a.bank})</span>}
                      {a.type === 'cartao' && (
                        <span className={`text-[10px] ${a.dueDay ? 'text-text-secondary' : 'text-accent'}`}>
                          Venc. dia {a.dueDay || 'não definido'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => startEditAccount(a)} className="text-text-secondary hover:text-accent p-1" title="Editar conta" aria-label={`Editar conta ${a.name}`}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteAccount(a.id)} className="text-text-secondary hover:text-accent-red p-1" title="Excluir conta" aria-label={`Excluir conta ${a.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Anthropic API Key */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <KeyRound size={16} className="text-accent" /> Chave API (Importacao com IA)
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Informe sua chave da Anthropic para usar a importacao de extratos por IA (PDF, Excel). A chave e salva apenas neste navegador.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[260px]">
            <input
              type={showKey ? 'text' : 'password'}
              value={anthropicKey}
              onChange={(e) => { setAnthropicKey(e.target.value); setKeySaved(false); }}
              placeholder="sk-ant-..."
              className={`${inputClass} w-full pr-9 text-xs`}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-2.5 text-text-secondary hover:text-text-primary"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('anthropic_api_key', anthropicKey.trim());
              setKeySaved(true);
            }}
            disabled={!anthropicKey.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
          >
            {keySaved ? <><Check size={14} /> Salvo</> : 'Salvar'}
          </button>
          {anthropicKey && (
            <button
              onClick={() => { localStorage.removeItem('anthropic_api_key'); setAnthropicKey(''); setKeySaved(false); }}
              className="text-text-secondary hover:text-accent-red"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {keySaved && (
          <p className="text-[10px] text-accent-green">Chave salva. A importacao com IA ja pode ser usada.</p>
        )}
        {!anthropicKey && (
          <p className="text-[10px] text-accent">
            Sem chave configurada — importacao com IA retornara erro. Obtenha sua chave em console.anthropic.com.
          </p>
        )}
      </div>

      {/* Titular Mappings */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <CreditCard size={16} className="text-accent" /> Mapeamento de Titulares
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Associe os ultimos 4 digitos do cartao ao nome do titular para identificacao automatica na importacao.
          </p>
        </div>
        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
          <input type="text" value={cardDigits} onChange={(e) => setCardDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 digitos do cartao" className={`${inputClass} w-40`} maxLength={4} />
          {memberNames.length > 0 ? (
            <select value={titularName} onChange={(e) => setTitularName(e.target.value)} className={`${inputClass} flex-1 min-w-[150px]`}>
              <option value="">Selecione o membro...</option>
              {memberNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input type="text" value={titularName} onChange={(e) => setTitularName(e.target.value)}
              placeholder="Cadastre membros na secao Familia primeiro" className={`${inputClass} flex-1 min-w-[150px]`} disabled />
          )}
          <button type="submit" disabled={cardDigits.length !== 4 || !titularName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50">
            <Plus size={14} /> Adicionar
          </button>
        </form>
        {mappings.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhum mapeamento cadastrado.</p>
        ) : (
          <div className="space-y-1">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-accent tnum font-bold">**** {m.cardLastDigits}</span>
                  <span className="text-text-secondary">→</span>
                  <span className="text-text-primary">{m.titularName}</span>
                </div>
                <button onClick={() => deleteMapping(m.id)} className="text-text-secondary hover:text-accent-red">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Backup & Restore */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Database size={16} className="text-accent" /> Backup e Restauracao
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Exporte um arquivo JSON com <strong>todos</strong> os seus dados (lancamentos, categorias, contas, cartoes, orcamentos, projetos, ciclos de fatura, familia, mapeamentos de titular e configuracoes locais). Guarde esse arquivo em local seguro — se o sistema perder o banco de dados, voce pode recarrega-lo por aqui e voltar exatamente de onde parou.
          </p>
        </div>

        <div className="bg-bg-secondary rounded p-3 space-y-1 text-[10px] text-text-secondary">
          <p className="font-bold text-text-primary text-xs">O que o backup inclui:</p>
          <p>• Todas as transacoes ({USER_COLLECTIONS.join(', ')})</p>
          <p>• Chaves e credenciais salvas neste navegador (Anthropic)</p>
          <p>• IDs originais dos documentos — ao restaurar, as referencias entre lancamentos e categorias/projetos continuam validas</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportBackup}
            disabled={backupBusy || restoreBusy}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
          >
            {backupBusy ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            Gerar backup completo
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFilePicked}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={backupBusy || restoreBusy}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-50"
          >
            <Upload size={13} /> Restaurar de arquivo...
          </button>
        </div>

        {backupMsg && (
          <p className={`text-[11px] font-bold ${backupMsg.type === 'ok' ? 'text-accent-green' : 'text-accent-red'}`}>
            {backupMsg.type === 'ok' ? '✓' : '✗'} {backupMsg.text}
          </p>
        )}

        {pendingBackup && (
          <div className="border border-accent-red/50 bg-accent-red/5 rounded p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-accent-red flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-xs font-bold text-text-primary">Confirmar restauracao</p>
                <p className="text-[10px] text-text-secondary">
                  Esta acao vai <strong>apagar todos os dados atuais</strong> da sua conta e substituir pelos dados do arquivo. Nao pode ser desfeita. Tenha certeza de que o arquivo esta correto antes de continuar.
                </p>
                {pendingBackup.exportedAt && (
                  <p className="text-[10px] text-text-secondary">
                    Backup gerado em: <strong>{new Date(pendingBackup.exportedAt).toLocaleString('pt-BR')}</strong>
                  </p>
                )}
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-text-secondary">
                  {summarizeBackup(pendingBackup).map((row) => (
                    <div key={row.collection} className="flex justify-between">
                      <span>{row.collection}</span>
                      <span className="text-text-primary font-bold">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleConfirmRestore}
                disabled={restoreBusy}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent-red text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
              >
                {restoreBusy ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                Sim, apagar e restaurar
              </button>
              <button
                onClick={handleCancelRestore}
                disabled={restoreBusy}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-50"
              >
                <X size={13} /> Cancelar
              </button>
            </div>
            {restoreBusy && restoreProgress && (
              <p className="text-[10px] text-text-secondary flex items-center gap-1.5 pt-0.5">
                <RefreshCw size={11} className="animate-spin flex-shrink-0" />
                {restoreProgress}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Normalizar titulares / membros (ferramenta one-time) */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <UserCheck size={16} className="text-accent" /> Normalizar Titulares
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Consolida nomes de titular/membro duplicados que vieram da importação ou da migração (ex.: "Juliana",
            "kuhn coutinho" e "coutinho" viram o mesmo membro cadastrado). Ferramenta de uso pontual, com
            pré-visualização antes de gravar. A atribuição feita a mão no cadastro de lançamento já usa o membro
            cadastrado e não precisa desta correção.
          </p>
        </div>
        <NormalizeTitulars />
      </div>

      {/* Preencher conta/membro a partir da fatura (ferramenta one-time) */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-accent" /> Preencher conta/membro pela fatura
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Reimporta os campos <b className="text-text-primary">conta, membro e número do cartão</b> que
            faltaram no import original, lendo as faturas (.xlsx) exportadas do Meu Dinheiro Web e casando cada
            lançamento por descrição, valor e data. Só escreve onde o campo está <b className="text-text-primary">vazio</b>;
            não apaga nem sobrescreve nada. Ferramenta de uso pontual, com pré-visualização antes de gravar.
          </p>
        </div>
        <BackfillInvoiceFields />
      </div>
    </div>
  );
}
