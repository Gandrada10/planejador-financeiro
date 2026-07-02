# Fase 0 — Segurança e integridade: checklist de deploy

Esta branch já **implementa em código** as partes seguras da Fase 0. Alguns
passos, porém, exigem ações no console (Firebase/Cloudflare) que só o dono/time
pode executar — este documento lista o que falta para a proteção ficar completa.

## Já implementado nesta branch (código)
- ✅ **`firestore.rules` versionadas** (raiz do repo) + `firebase.json`.
- ✅ **Chunking de 400** em `importBatch`/`batchUpdate`/`batchUpdateReconciled` (`src/hooks/useTransactions.ts`) — importações/edições grandes não estouram mais o limite de 500 do Firestore.
- ✅ **Cadastro aberto desligado por padrão** (`src/components/auth/LoginForm.tsx`), atrás do flag `VITE_ALLOW_REGISTRATION`.

## Falta executar (console — não dá para fazer pelo código)

### 1. Publicar as regras do Firestore  ⚠️ prioridade máxima
```bash
firebase login
firebase use <seu-projeto>      # ou: firebase use --add
firebase deploy --only firestore:rules
```
Antes de publicar, **verifique as regras ATUAIS no console** (Firestore → Regras).
Se estiverem no modo de teste (`allow read, write: if true`), toda a base está
aberta na internet hoje — publicar `firestore.rules` fecha isso. Teste depois:
o dono deve conseguir ler/gravar seus dados; um token de sessão válido deve
permitir categorizar; um token expirado, não.

### 2. Desativar o cadastro Email/Senha (proteção real)
O flag `VITE_ALLOW_REGISTRATION` só esconde a UI. A proteção de fato é no
console: **Authentication → Sign-in method** → em *Email/senha*, desabilite a
criação de novas contas (ou remova o provedor se ambos já usam Google). Mantenha
`VITE_ALLOW_REGISTRATION` vazio no ambiente de produção/preview.

### 3. Mover a chave Anthropic para secret do ambiente  (deferido — ver nota)
Hoje a chave vive no `localStorage` e trafega no corpo das requisições às
Functions, que aceitam `apiKey` de qualquer origem. O fim correto é: a chave
vira **secret no Cloudflare** (`ANTHROPIC_API_KEY`), as Functions passam a exigir
um Firebase ID token no header `Authorization` e param de aceitar `apiKey` do
body; o app remove o campo de chave.

**Por que não foi feito nesta branch:** autenticar as Functions e cortar o
`apiKey` do body quebraria a importação e o chat no preview enquanto o secret e
a verificação de token não estiverem no ar — meio-caminho é pior que o estado
atual. É uma mudança acoplada a infraestrutura; recomendo o time implementar
junto com o deploy (código das Functions + secret + verificação de JWT), testável
de uma vez. A auditoria detalha em `AUDITORIA-2026-07.md` §2.2–2.3.

## Observações sobre as regras
- `categorizationSessions/{token}` é legível por quem tem o link (capability
  URL) — isso é intencional. O documento expõe `userId` e metadados; os dados
  financeiros ficam nas subcoleções, também legíveis pelo link. A escrita
  pública é limitada a `categoryId`/`notes`/`applied` (transações) e
  `categorizedCount`/`lastActivityAt` (sessão), e só enquanto `expiresAt` é
  futuro.
- `list` na coleção de sessões exige autenticação. Como as regras não conseguem
  inspecionar o filtro da query, um usuário **autenticado** poderia teoricamente
  listar sessões de outro `userId`. No modelo atual (o casal são os únicos
  autenticados) o risco é aceitável; se um dia houver mais usuários, migrar as
  sessões para `users/{uid}/sessions` + um índice público por token.
- Falta uma limpeza/TTL das sessões expiradas (as subcoleções não são apagadas).
  Recomendado: **TTL policy** do Firestore no campo `expiresAt` da coleção
  `categorizationSessions` (console → Firestore → TTL).
