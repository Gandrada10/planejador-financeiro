import { useState } from 'react';
import { Plus, Trash2, Zap, X, ChevronRight, RefreshCw, Pencil } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import type { Category, CategoryRule } from '../../types';
import { CategoryIcon, ICON_KEYS } from '../shared/CategoryIcon';

const PRESET_COLORS = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

export function CategoriesPage() {
  const { categories, rootCategories, subCategories, rules, loading, addCategory, updateCategory, deleteCategory, addRule, updateRule, deleteRule, syncCategories } = useCategories();
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'despesa' | 'receita'>('despesa');

  // Category form
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('tag');
  const [color, setColor] = useState('#f59e0b');
  const [type, setType] = useState<Category['type']>('despesa');
  const [parentId, setParentId] = useState<string>('');

  // Rule form
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState('');
  const [ruleKeywords, setRuleKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  function resetForm() {
    setName(''); setIcon('tag'); setColor('#f59e0b'); setType('despesa'); setParentId('');
    setEditingId(null); setShowForm(false);
  }

  function startEdit(cat: Category) {
    setName(cat.name); setIcon(cat.icon); setColor(cat.color); setType(cat.type);
    setParentId(cat.parentId ?? '');
    setEditingId(cat.id); setShowForm(true);
  }

  function startNewSub(parentCatId: string) {
    const parent = categories.find((c) => c.id === parentCatId);
    if (parent) { setType(parent.type); setColor(parent.color); }
    setParentId(parentCatId);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const data = { name, icon, color, type, parentId: parentId || null };
    if (editingId) {
      await updateCategory(editingId, data);
    } else {
      await addCategory(data);
    }
    resetForm();
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!rulePattern.trim() || !ruleCategoryId) return;
    if (editingRuleId) {
      await updateRule(editingRuleId, { pattern: rulePattern, keywords: ruleKeywords, categoryId: ruleCategoryId });
    } else {
      await addRule({ pattern: rulePattern, keywords: ruleKeywords, categoryId: ruleCategoryId });
    }
    resetRuleForm();
  }

  function resetRuleForm() {
    setRulePattern(''); setRuleCategoryId(''); setRuleKeywords([]); setKeywordInput('');
    setEditingRuleId(null); setShowRuleForm(false);
  }

  function startEditRule(rule: CategoryRule) {
    setRulePattern(rule.pattern);
    setRuleCategoryId(rule.categoryId);
    setRuleKeywords(rule.keywords || []);
    setKeywordInput('');
    setEditingRuleId(rule.id);
    setShowRuleForm(true);
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !ruleKeywords.includes(kw)) {
      setRuleKeywords([...ruleKeywords, kw]);
    }
    setKeywordInput('');
  }

  if (loading) return <div className="text-accent text-sm animate-pulse">Carregando...</div>;

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] text-text-secondary mb-1 uppercase tracking-wider';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Categorias</h2>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setSyncing(true);
              const result = await syncCategories();
              setSyncing(false);
              if (result) alert(`Sincronizado! ${result.added} adicionadas, ${result.updated} atualizadas.`);
            }}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent">
            <Zap size={14} /> Regras de Categorias
            <span className="text-[10px] text-text-secondary">({rules.length})</span>
          </button>
          <button onClick={() => { setParentId(''); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
            <Plus size={14} /> Nova Categoria
          </button>
        </div>
      </div>

      {/* Categories grid — tabs for Despesas / Receitas */}
      {rootCategories.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
          Nenhuma categoria. Crie categorias para organizar suas transações.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {(
              [
                { key: 'despesa', label: 'Despesas', dotColor: 'bg-accent-red', activeColor: 'border-accent-red text-accent-red' },
                { key: 'receita', label: 'Receitas', dotColor: 'bg-accent-green', activeColor: 'border-accent-green text-accent-green' },
              ] as const
            ).map(({ key, label, dotColor, activeColor }) => {
              const count = rootCategories.filter((c) => c.type === key || c.type === 'ambos').length;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors -mb-px ${
                    activeTab === key
                      ? activeColor
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  {label}
                  <span className="text-[10px] text-text-secondary font-normal">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Active tab content */}
          <div className="space-y-2">
            {rootCategories
              .filter((c) => c.type === activeTab || c.type === 'ambos')
              .map((cat) => {
                const subs = subCategories(cat.id);
                return (
                  <div key={cat.id} className="bg-bg-card border border-border rounded-lg overflow-hidden">
                    {/* Parent row */}
                    <div
                      className="flex items-center gap-3 p-3 cursor-pointer hover:bg-bg-secondary/40 transition-colors"
                      onClick={() => startEdit(cat)}
                    >
                      <CategoryIcon icon={cat.icon} size={24} className="text-text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                          <span className="text-xs text-text-primary truncate">{cat.name}</span>
                          {cat.type === 'ambos' && (
                            <span className="text-[9px] text-text-secondary bg-bg-secondary px-1.5 py-0.5 rounded uppercase tracking-wider">ambos</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[10px] text-text-secondary">{rules.filter((r) => r.categoryId === cat.id).length} regras</span>
                          <span className="text-[10px] text-text-secondary">{subs.length} subcategorias</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); startNewSub(cat.id); }}
                        title="Nova subcategoria"
                        className="text-text-secondary hover:text-accent p-1 text-xs"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }}
                        className="text-text-secondary hover:text-accent-red p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Subcategory rows */}
                    {subs.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-3 p-2.5 pl-8 border-t border-border/40 cursor-pointer hover:bg-bg-secondary/20 transition-colors"
                        onClick={() => startEdit(sub)}
                      >
                        <ChevronRight size={12} className="text-text-secondary flex-shrink-0" />
                        <CategoryIcon icon={sub.icon} size={18} className="text-text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: sub.color }} />
                            <span className="text-xs text-text-primary truncate">{sub.name}</span>
                          </div>
                          <span className="text-[10px] text-text-secondary">{rules.filter((r) => r.categoryId === sub.id).length} regras</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCategory(sub.id); }}
                          className="text-text-secondary hover:text-accent-red p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            {rootCategories.filter((c) => c.type === activeTab || c.type === 'ambos').length === 0 && (
              <div className="bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
                Nenhuma categoria de {activeTab === 'despesa' ? 'despesa' : 'receita'}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rules modal */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4">
          <div className="bg-bg-card border border-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <Zap size={16} className="text-accent" /> Regras de Auto-categorizacao
                <span className="text-[10px] text-text-secondary font-normal">({rules.length})</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { resetRuleForm(); setShowRuleForm(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90"
                >
                  <Plus size={14} /> Nova Regra
                </button>
                <button onClick={() => setShowRulesModal(false)} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <p className="text-xs text-text-secondary mb-3">
                Quando uma transacao importada contem o padrao, ela e categorizada automaticamente. Use * como curinga: *UBER* reconhece qualquer texto com "UBER".
              </p>
              {rules.length > 0 ? (
                <div className="space-y-1">
                  {rules.map((rule) => {
                    const cat = categories.find((c) => c.id === rule.categoryId);
                    const parent = cat?.parentId ? categories.find((c) => c.id === cat.parentId) : null;
                    return (
                      <div key={rule.id} className="flex items-center gap-2 bg-bg-secondary/40 border border-border rounded p-2 text-xs">
                        <code className="text-accent bg-bg-secondary px-2 py-0.5 rounded flex-shrink-0">{rule.pattern}</code>
                        {rule.keywords?.length > 0 && rule.keywords.map((kw, i) => (
                          <code key={i} className="text-text-secondary bg-bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">{kw}</code>
                        ))}
                        <span className="text-text-secondary">→</span>
                        {cat && (
                          <span className="flex items-center gap-1 text-text-primary min-w-0">
                            {parent && <><CategoryIcon icon={parent.icon} size={12} className="text-text-secondary" /><span className="text-text-secondary truncate">{parent.name}</span><ChevronRight size={10} className="text-text-secondary" /></>}
                            <CategoryIcon icon={cat.icon} size={12} className="text-text-primary" />
                            <span className="truncate">{cat.name}</span>
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => startEditRule(rule)} className="text-text-secondary hover:text-accent">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => deleteRule(rule.id)} className="text-text-secondary hover:text-accent-red">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-border rounded-lg p-6 text-center text-text-secondary text-xs">
                  Nenhuma regra. Clique em "Nova Regra" para criar a primeira.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-border rounded-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">
                {editingId ? 'Editar' : 'Nova'} {parentId ? 'Subcategoria' : 'Categoria'}
              </h3>
              <button onClick={resetForm} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label className={labelClass}>Nome</label>
                <input tabIndex={1} type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required autoFocus />
              </div>
              <div>
                <label className={labelClass}>Categoria pai (opcional)</label>
                <select
                  tabIndex={2}
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— Nenhuma (categoria raiz) —</option>
                  {rootCategories.filter((c) => c.id !== editingId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Tipo</label>
                <div className="flex gap-2">
                  {(['despesa', 'receita', 'ambos'] as const).map((t) => (
                    <button key={t} tabIndex={3} type="button" onClick={() => setType(t)}
                      className={`flex-1 py-1.5 text-xs rounded ${type === t ? 'bg-accent text-bg-primary font-bold' : 'bg-bg-secondary text-text-secondary'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Icone</label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {ICON_KEYS.map((ic) => (
                    <button key={ic} tabIndex={4} type="button" onClick={() => setIcon(ic)}
                      className={`w-8 h-8 rounded flex items-center justify-center ${icon === ic ? 'bg-accent/20 ring-1 ring-accent' : 'bg-bg-secondary hover:bg-bg-secondary/80'}`}>
                      <CategoryIcon icon={ic} size={16} className="text-text-primary" />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Cor</label>
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button key={c} tabIndex={5} type="button" onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full ${color === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <button tabIndex={6} type="submit" className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90">
                {editingId ? 'Salvar' : 'Criar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Rule form modal */}
      {showRuleForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-border rounded-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">{editingRuleId ? 'Editar' : 'Nova'} Regra de Auto-categorizacao</h3>
              <button onClick={resetRuleForm} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveRule} className="p-4 space-y-3">
              <div>
                <label className={labelClass}>Padrao principal (use * como curinga)</label>
                <input tabIndex={1} type="text" value={rulePattern} onChange={(e) => setRulePattern(e.target.value)}
                  className={inputClass} placeholder="*UBER*" required autoFocus />
                <p className="text-[10px] text-text-secondary mt-1">Ex: *UBER* reconhece "UBER TRIP", "PAG UBER", etc.</p>
              </div>
              <div>
                <label className={labelClass}>Palavras alternativas</label>
                <div className="flex gap-2">
                  <input
                    tabIndex={2}
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                    className={inputClass}
                    placeholder="uber do brasil"
                  />
                  <button type="button" onClick={addKeyword} className="px-3 py-2 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent flex-shrink-0">
                    <Plus size={14} />
                  </button>
                </div>
                {ruleKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {ruleKeywords.map((kw, i) => (
                      <span key={i} className="flex items-center gap-1 bg-bg-secondary text-text-primary text-xs px-2 py-0.5 rounded">
                        {kw}
                        <button type="button" onClick={() => setRuleKeywords(ruleKeywords.filter((_, j) => j !== i))} className="text-text-secondary hover:text-accent-red">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-text-secondary mt-1">Palavras alternativas que tambem ativam esta regra. Pressione Enter para adicionar.</p>
              </div>
              <div>
                <label className={labelClass}>Categoria</label>
                <select tabIndex={3} value={ruleCategoryId} onChange={(e) => setRuleCategoryId(e.target.value)} className={inputClass} required>
                  <option value="">Selecione...</option>
                  {rootCategories.map((cat) => {
                    const subs = subCategories(cat.id);
                    return (
                      <optgroup key={cat.id} label={cat.name}>
                        <option value={cat.id}>{cat.name}</option>
                        {subs.map((sub) => (
                          <option key={sub.id} value={sub.id}>  ↳ {sub.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
              <button tabIndex={4} type="submit" className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90">
                {editingRuleId ? 'Salvar' : 'Criar Regra'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
