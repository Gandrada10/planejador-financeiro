import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { FxWallet } from '../types';

/**
 * Carteiras de moeda estrangeira — o carry-over entre importações de extrato
 * em moeda (ver `src/lib/fxLedger.ts`).
 *
 * Guarda UM snapshot por moeda: quanto sobrou no fim do último extrato
 * importado e quanto esse saldo custou em BRL. É o único dado que precisa
 * atravessar importações para o apreçamento FIFO continuar exato de um mês
 * para o outro — sem ele, cada arquivo novo recomeçaria do zero e o custo dos
 * euros herdados viraria estimativa.
 *
 * ── Por que SNAPSHOT e não acumulador ──────────────────────────────────────
 * O doc guarda o ESTADO no fim do período (`balanceFx`/`costBrl`), não um
 * total que se soma a cada importação. Isso torna a gravação idempotente:
 * reimportar o mesmo extrato reescreve exatamente os mesmos números, em vez
 * de dobrar o saldo. Como o saldo em moeda também vem no próprio arquivo
 * (`Running Balance`), a tela ainda confere um contra o outro antes de usar o
 * custo guardado — divergência vira aviso, não número errado silencioso.
 *
 * O id do documento é o código da moeda ("EUR"), então a escrita é um
 * `setDoc` determinístico: nunca gera duplicata, mesmo com duas abas abertas.
 */

function docToWallet(id: string, data: Record<string, unknown>): FxWallet {
  return {
    currency: id,
    balanceFx: typeof data.balanceFx === 'number' ? data.balanceFx : 0,
    costBrl: typeof data.costBrl === 'number' ? data.costBrl : 0,
    estimated: data.estimated === true,
    accountName: (data.accountName as string) || '',
    asOf: (data.asOf as Timestamp)?.toDate() || null,
    updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
  };
}

export function useFxWallets() {
  const [wallets, setWallets] = useState<FxWallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, 'users', uid, 'fxWallets');
    const unsub = onSnapshot(ref, (snap) => {
      setWallets(snap.docs.map((d) => docToWallet(d.id, d.data())));
      setLoading(false);
    });
    return unsub;
  }, []);

  /**
   * Grava o saldo/custo de fechamento de uma moeda. Chamado ao confirmar uma
   * importação de extrato em moeda estrangeira — o que fica aqui é o ponto de
   * partida da PRÓXIMA importação.
   */
  async function saveWallet(currency: string, snapshot: Omit<FxWallet, 'currency' | 'updatedAt'>) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(
      doc(db, 'users', uid, 'fxWallets', currency.toUpperCase()),
      {
        balanceFx: snapshot.balanceFx,
        costBrl: snapshot.costBrl,
        estimated: snapshot.estimated === true,
        accountName: snapshot.accountName,
        asOf: snapshot.asOf ? Timestamp.fromDate(snapshot.asOf) : null,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  }

  function walletFor(currency: string | null | undefined): FxWallet | null {
    if (!currency) return null;
    return wallets.find((w) => w.currency === currency.toUpperCase()) || null;
  }

  return { wallets, loading, saveWallet, walletFor };
}
