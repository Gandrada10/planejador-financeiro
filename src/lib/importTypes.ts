/**
 * Tipos da importação de extratos e faturas.
 *
 * Moravam dentro do `ImportModal` e saíram com a lógica que os usa (ver
 * `importDedupe.ts` e `importMapping.ts`): quem monta um lote fora da tela
 * precisa do MESMO formato de linha que a tela grava.
 */
import type { Transaction } from '../types';

export type ImportItem = Omit<Transaction, 'id' | 'createdAt'>;
export type ImportRow = ImportItem & {
  isDuplicate: boolean;
  /** POR QUE a linha foi marcada como duplicata. Sem isso o preview diz
   *  "84 possíveis duplicatas" e não há como saber contra o quê — se contra
   *  uma importação anterior que deu errado, contra lançamentos digitados à
   *  mão, ou contra nada (falso positivo). Era o que transformava um número
   *  assustador em beco sem saída. */
  duplicateOf?: { account: string; date: Date; description: string; via: 'id' | 'valor' | 'fatura' };
  installmentType: 'unica' | 'parcelada';
  periodicity: number; // months between installments
  installmentAmount: number | null;
};

/** Uma linha como a leitura por IA (`/api/parse-statement`) devolve. */
export interface AiParsedTransaction {
  date: string; purchaseDate: string | null; description: string;
  amount: number; titular: string;
  installmentNumber: number | null; totalInstallments: number | null; cardNumber: string | null;
}

/** Corpo da resposta de `/api/parse-statement`. */
export interface AiParseResponse {
  transactions: AiParsedTransaction[];
  isCreditCard?: boolean;
  declaredTotal?: number | null;
  accountDescriptor?: string | null;
  usage: { input_tokens: number; output_tokens: number };
}
