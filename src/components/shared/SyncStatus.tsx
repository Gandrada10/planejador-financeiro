import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { cn } from '../../lib/utils';

// Badge sempre visível que responde à dúvida "isso já subiu pro servidor?".
// Verde = tudo no servidor; âmbar = ainda subindo (não feche); vermelho = sem
// conexão (só neste aparelho até voltar a rede).
export function SyncStatus({ showLabel = true, className }: { showLabel?: boolean; className?: string }) {
  const state = useSyncStatus();

  const cfg =
    state === 'synced'
      ? { Icon: Cloud, label: 'Salvo', color: 'text-accent-green', spin: false, title: 'Tudo salvo no servidor.' }
      : state === 'pending'
      ? { Icon: RefreshCw, label: 'Salvando…', color: 'text-status-warn', spin: true, title: 'Há alterações ainda não confirmadas pelo servidor. Não feche nem troque de aparelho até ficar "Salvo".' }
      : { Icon: CloudOff, label: 'Sem conexão', color: 'text-accent-red', spin: false, title: 'Sem conexão. Suas mudanças estão só neste aparelho e sobem quando a internet voltar.' };

  const { Icon, label, color, spin, title } = cfg;

  return (
    <div className={cn('flex items-center gap-1.5 text-[10px] font-medium', color, className)} title={title}>
      <Icon size={12} className={cn('flex-shrink-0', spin && 'animate-spin')} />
      {showLabel && <span className="truncate">{label}</span>}
    </div>
  );
}
