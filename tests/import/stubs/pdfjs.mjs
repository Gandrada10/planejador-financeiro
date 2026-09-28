// pdf.js não roda aqui e não é preciso: os cenários entram por CSV, OFX e
// Wise. Se algum cenário cair no caminho de PDF, o erro diz por quê.
export const GlobalWorkerOptions = {};
export function getDocument() {
  throw new Error('pdf.js indisponível no teste de caracterização');
}
