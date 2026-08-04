export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rótulo longo para leitor de tela, quando o visível é abreviado ("24M"). */
  title?: string;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Obrigatório: o grupo precisa se anunciar ("Período do fluxo"). */
  ariaLabel: string;
  /** `lg` para a chave principal de uma página; `sm` (padrão) dentro de cards. */
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Chave de pílulas — o seletor de "lente" do app. Era o mesmo componente
 * escrito três vezes (LensButton no card de despesas, PeriodButton no card de
 * fluxo, e agora a chave Mês/Ano do dashboard); aqui ele existe uma vez só.
 *
 * O estado ativo se comunica por PESO E FUNDO, não só por cor — e cada botão
 * carrega `aria-pressed`, então quem navega por teclado ou leitor de tela ouve
 * qual lente está ligada.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  className = '',
}: Props<T>) {
  const pad = size === 'lg' ? 'px-4 py-1.5 text-body' : 'px-3 py-1 text-caption';

  return (
    <div
      className={`flex bg-bg-secondary border border-border rounded-control p-0.5 flex-shrink-0 ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.title}
            className={`tap ${pad} rounded-[10px] font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-elevated text-text-primary'
                : 'text-text-secondary hover:text-text-primary active:bg-elevated/60'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
