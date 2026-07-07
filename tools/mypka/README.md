# tools/mypka — ponte planejador → cockpit myPKA

Espelha os dados financeiros do Firestore no SQLite que o cockpit lê
(`mypka-financas.db`, criado na raiz do myPKA ao lado do `mypka.db`).
One-way: o Firestore continua a fonte da verdade; o cockpit só lê.

## Setup (uma vez, ~10 min)

1. **Gerar a service account** (credencial de leitura, fica só nesta máquina):
   - Console do Firebase → engrenagem → **Configurações do projeto** →
     aba **Contas de serviço** → botão **Gerar nova chave privada**.
   - Salve o arquivo baixado como `serviceAccountKey.json` **nesta pasta**
     (`tools/mypka/`). Ela está no `.gitignore` — nunca será commitada.
2. **Instalar a dependência:**
   ```
   pip install firebase-admin
   ```
3. **Descobrir o seu uid:**
   ```
   python tools/mypka/sync_cockpit.py --list-users
   ```

## Uso normal: o botão "Sincronizar" no cockpit

O botão POST /api/cockpit/finance/sync escolhe a fonte sozinho:
1. **Firestore ao vivo** — se `serviceAccountKey.json` existir nesta pasta
   (com uma única conta no projeto, o uid é descoberto automaticamente);
2. **Fallback**: o backup `planejador-financeiro-backup_*.json` mais recente
   em `~/Downloads` (exportado pelo app em Configurações → Backup).

## Uso manual (equivalente)

```
python tools/mypka/sync_cockpit.py                      # Firestore, uid automático
python tools/mypka/sync_cockpit.py --backup <arquivo>   # a partir de um backup
```

Saída: `mypka-financas.db` na raiz do myPKA, com tabelas `fin_*` e as views
`v_fin_counted`, `v_fin_monthly`, `v_fin_category_month`. A escrita é atômica
(temp + rename) — pode rodar com o cockpit aberto.

## Convenções espelhadas do app (não viole em consumidores)

- `amount` é assinado: receita > 0, despesa < 0.
- Toda agregação parte de `v_fin_counted` (aplica `excludeFromTotals` — a
  regra `countsInTotals` de `src/lib/utils.ts`), nunca de `fin_transactions`.
- Categoria pai agrega subs via `root_category_id`; nunca somar pai + sub.
- Mês de fatura de cartão = `billing_month`, não `date`.

## Segurança

- A chave da service account dá acesso total ao projeto Firebase: fica fora
  do git, fora de backups sincronizados, só nesta máquina.
- O script apenas LÊ o Firestore. Nenhuma escrita, nenhum delete.
