import { useMemo, useState } from 'react';
import { RefreshCw, Check, X, AlertTriangle, ShieldAlert, ArrowRight, Users } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { fuzzyMatchMember } from '../../lib/utils';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { Transaction, TitularMapping } from '../../types';

// ---------- types ----------

/** Um valor cru distinto encontrado em `titular`/`familyMember`, com contagem. */
interface Variant {
  value: string;
  count: number; // transações distintas que contêm este valor em qualquer dos dois campos
}

/** Grupo de consolidação: um alvo canônico e os valores crus que caem nele. */
interface Group {
  key: string;
  suggestedTarget: string; // '' quando não reconhecido
  variants: Variant[];
  isMatched: boolean;
}

/** Decisão do usuário por grupo. */
interface Override {
  target: string; // nome canônico do membro; '' = sem alvo
  skip: boolean; // "não mexer"
}

type Phase = 'idle' | 'previewed' | 'applying' | 'done';

// ---------- helpers ----------

/** Sugere o membro canônico para um valor cru: mapa de 4 dígitos primeiro, depois fuzzy. */
function suggestTarget(
  raw: string,
  memberNames: string[],
  mappings: TitularMapping[]
): string {
  const digits = raw.match(/\d{4}/);
  if (digits) {
    const m = mappings.find((mp) => mp.cardLastDigits === digits[0]);
    if (m && memberNames.includes(m.titularName)) return m.titularName;
  }
  return fuzzyMatchMember(raw, memberNames);
}

// ---------- component ----------

export function NormalizeTitulars() {
  const { transactions, loading, batchUpdate } = useTransactions();
  const { memberNames, loading: loadingMembers } = useFamilyMembers();
  const { mappings } = useTitularMappings();

  const [phase, setPhase] = useState<Phase>('idle');
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; groups: number } | null>(null);

  // ─── Descoberta: agrupa os valores crus por alvo sugerido ──────────────────
  const groups = useMemo<Group[]>(() => {
    if (memberNames.length === 0) return [];

    // Conta ocorrências distintas (por transação) de cada valor cru.
    const counts = new Map<string, Set<string>>();
    const bump = (value: string, txId: string) => {
      const v = value.trim();
      if (!v) return;
      const set = counts.get(v) ?? new Set<string>();
      set.add(txId);
      counts.set(v, set);
    };
    for (const t of transactions) {
      bump(t.familyMember, t.id);
      bump(t.titular, t.id);
    }

    // Agrupa valores por alvo sugerido; ignora os que já são o próprio canônico.
    const matched = new Map<string, Variant[]>();
    const unmatched: Group[] = [];

    for (const [value, ids] of counts) {
      const target = suggestTarget(value, memberNames, mappings);
      if (target) {
        if (value === target) continue; // já limpo — não é pendência
        const list = matched.get(target) ?? [];
        list.push({ value, count: ids.size });
        matched.set(target, list);
      } else {
        // Não reconhecido — vira um grupo próprio, "não mexer" por padrão.
        unmatched.push({
          key: `?::${value}`,
          suggestedTarget: '',
          variants: [{ value, count: ids.size }],
          isMatched: false,
        });
      }
    }

    const matchedGroups: Group[] = [...matched.entries()]
      .filter(([, variants]) => variants.length > 0)
      .map(([target, variants]) => ({
        key: target,
        suggestedTarget: target,
        variants: variants.sort((a, b) => b.count - a.count),
        isMatched: true,
      }))
      .sort((a, b) => b.variants.length - a.variants.length);

    return [...matchedGroups, ...unmatched.sort((a, b) => b.variants[0].count - a.variants[0].count)];
  }, [transactions, memberNames, mappings]);

  const effective = (g: Group): Override =>
    overrides[g.key] ?? { target: g.suggestedTarget, skip: !g.isMatched };

  // ─── Plano de aplicação (dry-run puro, não escreve) ────────────────────────
  const plan = useMemo(() => {
    // Mapa valor-cru → alvo (string) ou null (deixar como está).
    const decisions = new Map<string, string | null>();
    for (const g of groups) {
      const ov = effective(g);
      const target = !ov.skip && memberNames.includes(ov.target) ? ov.target : null;
      for (const v of g.variants) decisions.set(v.value, target);
    }

    const byTarget = new Map<string, string[]>(); // alvo → ids a atualizar
    let conflicts = 0;

    for (const t of transactions) {
      const fmVal = (t.familyMember || '').trim();
      const tiVal = (t.titular || '').trim();
      const fmTarget = fmVal ? decisions.get(fmVal) : undefined; // undefined = limpo, null = não mexer, string = alvo
      const tiTarget = tiVal ? decisions.get(tiVal) : undefined;

      const targets = new Set<string>();
      if (typeof fmTarget === 'string' && fmTarget) targets.add(fmTarget);
      if (typeof tiTarget === 'string' && tiTarget) targets.add(tiTarget);
      if (targets.size === 0) continue; // nada a mudar
      if (targets.size > 1) {
        conflicts++;
        continue;
      }
      const T = [...targets][0];

      // Bloqueio: um campo não-vazio que NÃO é vazio, NÃO é T e NÃO é variante→T
      const fmBlocking = !!fmVal && fmVal !== T && fmTarget !== T;
      const tiBlocking = !!tiVal && tiVal !== T && tiTarget !== T;
      if (fmBlocking || tiBlocking) {
        conflicts++;
        continue;
      }

      if (fmVal === T && tiVal === T) continue; // já consistente
      const ids = byTarget.get(T) ?? [];
      ids.push(t.id);
      byTarget.set(T, ids);
    }

    const totalAffected = [...byTarget.values()].reduce((s, ids) => s + ids.length, 0);
    return { byTarget, conflicts, totalAffected };
  }, [groups, overrides, transactions, memberNames]);

  const pendingGroups = groups.filter((g) => (plan.byTarget.get(effective(g).target)?.length ?? 0) > 0);

  // ─── Ações ─────────────────────────────────────────────────────────────────
  function handlePreview() {
    setError(null);
    setResult(null);
    // Inicializa overrides a partir das sugestões, preservando edições já feitas.
    setOverrides((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (!(g.key in next)) next[g.key] = { target: g.suggestedTarget, skip: !g.isMatched };
      }
      return next;
    });
    setPhase('previewed');
  }

  function setGroupTarget(g: Group, value: string) {
    setOverrides((prev) => ({
      ...prev,
      [g.key]: value === '' ? { target: '', skip: true } : { target: value, skip: false },
    }));
  }

  async function handleApply() {
    setConfirmOpen(false);
    setError(null);
    setPhase('applying');
    setProgress({ current: 0, total: plan.totalAffected });
    try {
      let done = 0;
      let groupsConsolidated = 0;
      for (const [target, ids] of plan.byTarget) {
        if (ids.length === 0) continue;
        // Escreve os dois campos com o nome canônico exato. `batchUpdate` já
        // comita em blocos de 400 e normaliza `titular` (mesma normalização que
        // o app aplica na leitura), então os dois campos ficam consistentes.
        await batchUpdate(ids, { familyMember: target, titular: target } as Partial<Transaction>);
        done += ids.length;
        groupsConsolidated++;
        setProgress({ current: done, total: plan.totalAffected });
      }
      setResult({ updated: done, groups: groupsConsolidated });
      setPhase('done');
    } catch (err) {
      setError(`Erro ao aplicar: ${err instanceof Error ? err.message : String(err)}`);
      setPhase('previewed');
    }
  }

  function reset() {
    setOverrides({});
    setAcknowledged(false);
    setResult(null);
    setError(null);
    setProgress({ current: 0, total: 0 });
    setPhase('idle');
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading || loadingMembers) {
    return <p className="text-xs text-text-secondary animate-pulse">Carregando lançamentos...</p>;
  }

  if (memberNames.length === 0) {
    return (
      <p className="text-[11px] text-text-secondary flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-status-warn" />
        Cadastre os membros da família (seção acima) antes de normalizar os titulares.
      </p>
    );
  }

  const noPending = phase !== 'idle' && pendingGroups.length === 0 && plan.conflicts === 0;

  return (
    <div className="space-y-3">
      {/* Banner de guarda-corpo */}
      <div className="flex items-start gap-2 bg-accent-red/5 border border-accent-red/40 rounded p-2.5">
        <ShieldAlert size={14} className="text-accent-red flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[11px] text-text-secondary leading-snug">
          <strong className="text-text-primary">Faça um backup antes</strong> (Configurações → Backup e
          Restauração → Gerar backup completo). Esta ação <strong className="text-text-primary">altera
          lançamentos existentes</strong>, unificando os nomes de titular/membro. Pré-visualize primeiro; nada é
          gravado até você confirmar.
        </p>
      </div>

      {error && (
        <p className="text-[11px] font-bold text-accent-red flex items-center gap-1" role="alert">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {/* Passo 1 — Pré-visualizar */}
      {phase === 'idle' && (
        <button
          onClick={handlePreview}
          className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
        >
          <Users size={13} /> Pré-visualizar duplicatas de titular
        </button>
      )}

      {/* Resultado final */}
      {phase === 'done' && result && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-accent-green flex items-center gap-1">
            <Check size={12} /> {result.updated} lançamento(s) atualizado(s), {result.groups} grupo(s)
            consolidado(s).
          </p>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
          >
            <RefreshCw size={13} /> Rodar de novo
          </button>
        </div>
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

      {/* Pré-visualização editável */}
      {phase === 'previewed' && (
        <div className="space-y-3">
          {noPending ? (
            <p className="text-[11px] text-accent-green font-bold flex items-center gap-1">
              <Check size={12} /> Nenhuma duplicata pendente — os titulares já estão consistentes.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-[11px] text-text-secondary">
                  <strong className="text-text-primary">{pendingGroups.length} grupo(s)</strong> a consolidar ·{' '}
                  <strong className="text-text-primary">{plan.totalAffected}</strong> lançamento(s) afetado(s)
                  {plan.conflicts > 0 && (
                    <>
                      {' '}
                      · <span className="text-status-warn font-bold">{plan.conflicts} conflito(s) ignorado(s)</span>
                    </>
                  )}
                </p>
              </div>

              <div className="max-h-[420px] overflow-y-auto space-y-1.5">
                {groups.map((g) => {
                  const ov = effective(g);
                  const affected = plan.byTarget.get(ov.target)?.length ?? 0;
                  const inactive = ov.skip || affected === 0;
                  return (
                    <div
                      key={g.key}
                      className={`bg-bg-secondary rounded p-2.5 space-y-1.5 ${inactive ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <ArrowRight size={12} className="text-accent flex-shrink-0" aria-hidden="true" />
                        <select
                          aria-label={`Alvo canônico para ${g.variants.map((v) => v.value).join(', ')}`}
                          value={ov.skip ? '' : ov.target}
                          onChange={(e) => setGroupTarget(g, e.target.value)}
                          className={`px-1.5 py-1 text-[11px] rounded bg-bg-card border ${
                            inactive ? 'border-border text-text-secondary' : 'border-accent text-text-primary'
                          } max-w-[220px] font-bold`}
                        >
                          <option value="">Não mexer</option>
                          {memberNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        {!inactive && (
                          <span className="text-[10px] text-text-secondary">
                            {affected} lançamento(s)
                          </span>
                        )}
                        {!g.isMatched && (
                          <span className="text-[9px] uppercase tracking-wide text-status-warn font-bold">
                            não reconhecido
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 pl-5">
                        {g.variants.map((v) => (
                          <span
                            key={v.value}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-secondary"
                          >
                            {v.value} <span className="text-text-primary/70">· {v.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {plan.conflicts > 0 && (
            <p className="text-[10px] text-text-secondary flex items-start gap-1.5">
              <AlertTriangle size={11} className="text-status-warn flex-shrink-0 mt-0.5" />
              Conflitos: lançamentos cujos campos apontam para dois membros diferentes não são tocados — ajuste-os
              manualmente na aba Lançamentos.
            </p>
          )}

          {/* Guarda-corpo: confirmação de backup */}
          {!noPending && (
            <label className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>Li o aviso e já fiz um backup completo dos meus dados.</span>
            </label>
          )}

          <div className="flex gap-2">
            {!noPending && (
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={!acknowledged || plan.totalAffected === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={13} /> Aplicar ({plan.totalAffected})
              </button>
            )}
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent"
            >
              <X size={13} /> {noPending ? 'Fechar' : 'Cancelar'}
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          destructive
          title="Aplicar normalização de titulares?"
          message={`${plan.totalAffected} lançamento(s) serão atualizados para unificar ${pendingGroups.length} grupo(s) de nomes. Esta ação altera dados existentes — confirme que você fez o backup.`}
          confirmLabel="Aplicar agora"
          cancelLabel="Cancelar"
          onConfirm={handleApply}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
