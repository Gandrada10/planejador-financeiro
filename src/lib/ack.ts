/**
 * Espera a confirmação do SERVIDOR com teto.
 *
 * ── O problema ─────────────────────────────────────────────────────────────
 * Toda promise de escrita do Firestore (`setDoc`, `batch.commit`, ...) só
 * resolve quando o backend confirma. A gravação LOCAL já aconteceu antes
 * disso, na fila durável do IndexedDB (ver `lib/firebase.ts`): offline, o dado
 * está salvo e sobe sozinho na próxima conexão. Mas a promise fica pendente
 * por tempo indeterminado, e QUALQUER tela que a espere para fechar um modal
 * ou desligar um "Salvando..." congela sem explicação — foi assim que o botão
 * "Importar" ficou preso depois de a gravação já ter dado certo.
 *
 * ── O contrato ─────────────────────────────────────────────────────────────
 * Passado o teto, resolve mesmo assim: a tela segue e quem carrega o estado é
 * o indicador de sincronização da barra lateral ("Salvando…"/"Offline"), que
 * existe para isso. Erro real (permissão, dado inválido) continua chegando a
 * quem chamou — desde que chegue dentro do teto; depois disso ele vira log e
 * fica com o indicador.
 *
 * Use em toda escrita cujo resultado a INTERFACE espera. Escrita
 * dispare-e-esqueça (edição de célula, por exemplo) não precisa.
 *
 * Vive fora de `lib/firebase.ts` de propósito: sem importar o SDK, esta função
 * pode ser exercitada num teste ou num preview sem subir o app inteiro.
 */
export const ACK_TIMEOUT_MS = 8000;

export function ackOrQueued(write: Promise<unknown>, timeoutMs = ACK_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([write.then(() => undefined), capped]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
