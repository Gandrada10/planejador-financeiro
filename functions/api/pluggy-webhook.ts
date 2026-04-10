/**
 * Pluggy Webhook Receiver
 *
 * Pluggy exige um endpoint público para eventos como:
 * item/created, item/updated, transactions/created, transactions/updated, transactions/deleted
 *
 * Este sistema usa sincronização on-demand (o usuário clica para importar),
 * então este endpoint só precisa existir, receber e confirmar (200 OK).
 */

interface PluggyWebhookPayload {
  event: string;       // ex: "transactions/created"
  itemId?: string;
  data?: unknown;
}

export const onRequestPost: PagesFunction = async (context) => {
  let payload: PluggyWebhookPayload;
  try {
    payload = await context.request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  console.log(`[pluggy-webhook] event=${payload.event} itemId=${payload.itemId ?? '-'}`);

  // Responde 200 para o Pluggy confirmar o recebimento.
  // A sincronização real acontece on-demand quando o usuário clica em importar.
  return new Response('OK', { status: 200 });
};
