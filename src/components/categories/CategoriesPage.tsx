import { useState } from 'react';
import { Plus, Trash2, Zap, X } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import type { Category } from '../../types';

const PRESET_COLORS = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];
const PRESET_ICONS = ['🏠', '🍔', '🚗', '💊', '📚', '🎮', '📺', '💳', '✈️', '👕', '🛒', '💰', '📱', '🏋️', '🎵', '🐕', '👶', '🔧', '⚡', '💼'];

export function CategoriesPage() {
  const { categories, rules, loading, addCategory, updateCategory, deleteCategory, addRule, deleteRule } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Category form
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [color, setColor] = useState('#f59e0b');
  const [type, setType] = useState<Category['type']>('despesa');

  // Rule form
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState('');

  function resetForm() {
    setName(''); setIcon('🏷️'); setColor('#f59e0b'); setType('despesa');
    setEditingId(null); setShowForm(false);
  }

  function startEdit(cat: Category) {
    setName(cat.name); setIcon(cat.icon); setColor(cat.color); setType(cat.type);
    setEditingId(cat.id); setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingId) {
      await updateCategory(editingId, { name, icon, color, type });
    } else {
      await addCategory({ name, icon, color, type });
    }
    resetForm();
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!rulePattern.trim() || !ruleCategoryId) return;
    await addRule({ pattern: rulePattern, categoryId: ruleCategoryId });
    setRulePattern(''); setRuleCategoryId(''); setShowRuleForm(false);
  }

  if (loading) return <div className="text-accent text-sm animate-pulse">Carregando...</div>;

  const inputClass = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';
  const labelClass = 'block text-[10px] text-text-secondary mb-1 uppercase tracking-wider';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Categorias</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowRuleForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border text-text-primary text-xs rounded hover:border-accent">
            <Zap size={14} /> Nova Regra
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90">
            <Plus size={14} /> Nova Categoria
          </button>
        </div>
      </div>

      {/* Categories grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-bg-card border border-border rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:border-accent/50 transition-colors"
            onClick={() => startEdit(cat)}
          >
            <span className="text-2xl">{cat.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                <span className="text-sm text-text-primary font-bold truncate">{cat.name}</span>
              </div>
              <span className="text-[10px] text-text-secondary uppercase">{cat.type}</span>
              <div className="text-[10px] text-text-secondary mt-0.5">
                {rules.filter((r) => r.categoryId === cat.id).length} regras
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }}
              className="text-text-secondary hover:text-accent-red p-1"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {categories.length === 0 && (
          <div className="col-span-full bg-bg-card border border-border rounded-lg p-6 text-center text-text-secondary text-sm">
            Nenhuma categoria. Crie categorias para organizar suas transacoes.
          </div>
        )}
      </div>

      {/* Rules section */}
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
          <Zap size={16} className="text-accent" /> Regras de Auto-categorizacao
        </h3>
        <p className="text-xs text-text-secondary mb-3">
          Quando uma transacao importada contem o padrao, ela e categorizada automaticamente. Use * como curinga: *UBER* reconhece qualquer texto com "UBER".
        </p>
        {rules.length > 0 ? (
          <div className="space-y-1">
            {rules.map((rule) => {
              const cat = categories.find((c) => c.id === rule.categoryId);
              return (
                <div key={rule.id} className="flex items-center gap-3 bg-bg-card border border-border rounded p-2 text-xs">
                  <code className="text-accent bg-bg-secondary px-2 py-0.5 rounded">{rule.pattern}</code>
                  <span className="text-text-secondary">→</span>
                  {cat && (
                    <span className="flex items-center gap-1">
                      <span>{cat.icon}</span>
                      <span className="text-text-primary">{cat.name}</span>
                    </span>
                  )}
                  <button onClick={() => deleteRule(rule.id)} className="ml-auto text-text-secondary hover:text-accent-red">
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-lg p-4 text-center text-text-secondary text-xs">
            Nenhuma regra. Crie regras para categorizar transacoes automaticamente na importacao.
          </div>
        )}
      </div>

      {/* Category form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-border rounded-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">{editingId ? 'Editar' : 'Nova'} Categoria</h3>
              <button onClick={resetForm} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div>
                <label className={labelClass}>Nome</label>
                <input tabIndex={1} type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required autoFocus />
              </div>
              <div>
                <label className={labelClass}>Tipo</label>
                <div className="flex gap-2">
                  {(['despesa', 'receita', 'ambos'] as const).map((t) => (
                    <button
                      key={t}
                      tabIndex={2}
                      type="button"
                      onClick={() => setType(t)}
                      className={`flex-1 py-1.5 text-xs rounded ${type === t ? 'bg-accent text-bg-primary font-bold' : 'bg-bg-secondary text-text-secondary'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Icone</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_ICONS.map((ic) => (
                    <button
                      key={ic}
                      tabIndex={3}
                      type="button"
                      onClick={() => setIcon(ic)}
                      className={`w-8 h-8 rounded text-lg flex items-center justify-center ${icon === ic ? 'bg-accent/20 ring-1 ring-accent' : 'bg-bg-secondary hover:bg-bg-secondary/80'}`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Cor</label>
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      tabIndex={4}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full ${color === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <button tabIndex={5} type="submit" className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90">
                {editingId ? 'Salvar' : 'Criar Categoria'}
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
              <h3 className="text-sm font-bold text-text-primary">Nova Regra de Auto-categorizacao</h3>
              <button onClick={() => setShowRuleForm(false)} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddRule} className="p-4 space-y-3">
              <div>
                <label className={labelClass}>Padrao (use * como curinga)</label>
                <input
                  tabIndex={1}
                  type="text"
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  className={inputClass}
                  placeholder="*UBER*, *NETFLIX*, ALUGUEL*"
                  required
                  autoFocus
                />
                <p className="text-[10px] text-text-secondary mt-1">
                  Ex: *UBER* reconhece "UBER TRIP", "PAG UBER", etc.
                </p>
              </div>
              <div>
                <label className={labelClass}>Categoria</label>
                <select
                  tabIndex={2}
                  value={ruleCategoryId}
                  onChange={(e) => setRuleCategoryId(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Selecione...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                  ))}
                </select>
              </div>
              <button tabIndex={3} type="submit" className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90">
                Criar Regra
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
