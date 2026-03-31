import { useState } from 'react';
import { Plus, Trash2, CreditCard } from 'lucide-react';
import { useTitularMappings } from '../../hooks/useTitularMappings';

export function SettingsPage() {
  const { mappings, loading, addMapping, deleteMapping } = useTitularMappings();
  const [cardDigits, setCardDigits] = useState('');
  const [titularName, setTitularName] = useState('');

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!cardDigits || !titularName) return;
    await addMapping({ cardLastDigits: cardDigits.slice(-4), titularName: titularName.trim() });
    setCardDigits('');
    setTitularName('');
  }

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando configuracoes...</div>;
  }

  const inputClass = 'px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-text-primary">Configuracoes</h2>

      {/* Titular Mappings */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <CreditCard size={16} className="text-accent" />
            Mapeamento de Titulares
          </h3>
          <p className="text-[10px] text-text-secondary mt-1">
            Associe os ultimos 4 digitos do cartao ao nome do titular. Quando importar transacoes, o sistema identifica automaticamente quem fez a compra.
          </p>
        </div>

        <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={cardDigits}
            onChange={(e) => setCardDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 digitos do cartao"
            className={`${inputClass} w-40`}
            maxLength={4}
          />
          <input
            type="text"
            value={titularName}
            onChange={(e) => setTitularName(e.target.value)}
            placeholder="Nome do titular"
            className={`${inputClass} flex-1 min-w-[150px]`}
          />
          <button
            type="submit"
            disabled={cardDigits.length !== 4 || !titularName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> Adicionar
          </button>
        </form>

        {mappings.length === 0 ? (
          <p className="text-xs text-text-secondary">Nenhum mapeamento cadastrado.</p>
        ) : (
          <div className="space-y-1">
            {mappings.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="text-accent font-mono font-bold">**** {m.cardLastDigits}</span>
                  <span className="text-text-secondary">→</span>
                  <span className="text-text-primary">{m.titularName}</span>
                </div>
                <button
                  onClick={() => deleteMapping(m.id)}
                  className="text-text-secondary hover:text-accent-red"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
