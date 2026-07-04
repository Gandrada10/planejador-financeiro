# Testes das firestore.rules (emulador — zero contato com produção)

Suite de testes de segurança das `firestore.rules` da raiz do repo, rodando
contra o **Firestore Emulator** com `@firebase/rules-unit-testing`. O projeto
usado é `demo-planejador-rules` — o prefixo `demo-` garante, por contrato do
firebase-tools, que **nenhuma chamada sai para um backend real**. Não é preciso
`firebase login` nem credencial nenhuma.

## Pré-requisitos

- Node 20+ (o repo roda em Node 24).
- **Java (JDK) 11 ou superior** no PATH — o emulador do Firestore é um JAR.
  *Atenção: a máquina atual tem Java 8, que NÃO serve. Instalar um JDK LTS
  (ex.: Temurin 21, winget `EclipseAdoptium.Temurin.21.JDK`) resolve.*
- Dependências locais desta pasta (nada global):

```bash
cd tests/firestore-rules
npm install
```

`firebase-tools` está nas devDependencies desta pasta, então o binário
`firebase` fica disponível via `npx`/scripts sem instalação global.

## Rodar (opção A — um comando)

```bash
cd tests/firestore-rules
npm run test:exec
# = firebase emulators:exec --only firestore --project demo-planejador-rules "node --test rules.test.mjs"
```

Sobe o emulador, roda a suite, derruba o emulador. Nada toca produção.

## Rodar (opção B — emulador aberto em um terminal)

```bash
# Terminal 1 (deixa rodando; porta 8080, ver firebase.json)
cd tests/firestore-rules
npm run emulator
# = firebase emulators:start --only firestore --project demo-planejador-rules

# Terminal 2
cd tests/firestore-rules
npm test
```

## O que a suite cobre (35 testes)

1. **`list` de sessões:** anônimo nunca lista (nem com filtro); conta estranha
   não lista sessões de outro dono; o dono lista com a query do hook
   (`where('userId','==',uid)`).
2. **Expiração na leitura:** anônimo ainda dá `get` no doc da sessão expirada
   (mensagem amigável), mas NÃO lê as subcoleções `transactions`/`categories`
   dela; sessão válida continua legível (fluxo da esposa); o dono lê subcoleção
   mesmo expirada (apply do delta).
3. **Update público da transação:** categorizar/desfazer válidos passam;
   `applied:true`, `categoryId`/`notes` de tipo ou tamanho inválido,
   `amount`/`description`/`date`, escrita pós-expiração e create/forja por
   anônimo ou conta estranha — todos negados.
4. **Update público da sessão:** contadores válidos passam; `categorizedCount`
   negativo/acima do total/string, `expiresAt` (extensão), `status`,
   `transactionIds`, `userId` e update pós-expiração — todos negados.
5. **`create` de sessão:** só autenticado e só em nome próprio; tipos de
   `expiresAt`/`transactionIds` validados.
6. **`/users/{uid}`:** dono lê/escreve; estranho e anônimo, não.
7. **Integração com a frente de robustez (Felix):** `categorizedCount` via
   `increment()` atômico — as rules avaliam o valor PÓS-transform, então
   incremento dentro do range passa e além do teto/abaixo de zero é negado
   (sessão dedicada `TOK_COUNTER`, independente de ordem); renovação de
   `expiresAt` (apply/`reopenSession`) passa como escrita do DONO e é negada ao
   anônimo (inclusive em sessão expirada); `applied:true + orphaned:true` na
   subcoleção (delta órfão do C3) passa para o dono e `orphaned` é negado ao
   público.

## Quando rodar

Obrigatório **antes de qualquer `firebase deploy --only firestore:rules`**
(plano de validação da `docs/REVISAO-RESULTADOS.md`, seção 5). O snapshot de
rollback das rules de produção está em `docs/rules-producao-2026-07-03.txt`.
