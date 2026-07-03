# Roteiro de teste em aparelho real — Etapa B (Vera, 2026-07-03)

Re-gate estático: **PASS** (6/6 condições, zero HIGH). Este roteiro é a etapa final de validação,
executada pelo Guilherme no celular. Depois do teste OK → commitar o working tree → merge do PR #25.

## Passo a passo

1. **No computador:** Transações → "Categorização compartilhada" → "Enviar p/ categorizar" → crie a sessão e copie o link. *Esperado: link gerado.*
2. **Envie o link pra você mesmo** (WhatsApp) e abra no celular. *Esperado: tela escura "Oi, [nome]", barra de progresso, card com a data e um **chip cinza com o nome da conta/cartão** ao lado.*
3. **Categorize 1 item pelo botão de sugestão** ("É Mercado?") com 1 toque. *Esperado: card desliza pro lado, o próximo aparece, e embaixo surge o aviso "Marcado como Mercado — Desfazer", que some sozinho em ~8 segundos.*
4. **Toque em "Buscar categoria"**, digite algo (pode ser sem acento), toque no **X** pra limpar, depois em **"Fechar"**. *Esperado: a busca filtra, o X limpa o texto, Fechar fecha a janela.*
5. **Ative o modo avião** e tente categorizar um item. *Esperado: em até ~12 segundos aparece uma **faixa vermelha** "Não consegui salvar — verifique a internet e tente de novo" com o botão "Tentar de novo". A tela NÃO congela nem fica em branco.*
6. **Desative o modo avião** e toque em "Tentar de novo". *Esperado: salva e avança pro próximo item.*
7. **Categorize até o ÚLTIMO item.** Na tela "Tudo categorizado!", toque em **"Desfazer"** no aviso embaixo (antes dos 8 segundos). *Esperado: volta pro card daquele item — o desfazer funciona mesmo no último.*
8. **No computador:** apague UMA transação que esteja na sessão (lixeira na tabela) e depois clique em **"Aplicar"** na faixa verde da sessão. *Esperado: mensagem "X categoria(s) aplicada(s). 1 ignorada(s) porque a(s) transação(ões) foi(ram) excluída(s)." — sem erro e sem travar as demais.*
9. **(Se viável) Sessão expirada:** deixe uma sessão parcialmente feita passar de 48h. *Esperado: no computador aparece a faixa âmbar "expirada · X pendentes" com "Aplicar parciais" e "Reabrir 48h"; ao clicar "Reabrir 48h", o link no celular volta a funcionar.*
10. **No computador:** abra Dashboard e Relatórios. *Esperado: colunas de valores com dígitos alinhados (sem fonte de máquina de escrever); labels cinza-claros legíveis; apertando Tab, todo elemento focado mostra um **anel verde-menta** visível.*

## Backlog registrado pela Vera (não bloqueia merge)

**MEDIUM:** (1) undo sem try/catch — falha em silêncio offline; (2) toast de undo sem `aria-live`.
**LOW:** caminho de erro do sheet não devolve foco; `.tnum` vs `tabular-nums` duas grafias; `alert()` nativo no apply desktop; X de dispensar sessão <44px (desktop); `expiredSessions` só recalcula em re-render; barra de progresso sem `role="progressbar"`.

## Sequência pós-teste

1. Teste real OK → **commitar o working tree da branch** (lição do commit 9560e57: nunca deixar correções soltas).
2. Merge do PR #25.
3. **Etapa C (produção):** instalar JDK (`winget install EclipseAdoptium.Temurin.21.JDK`) → rodar a suite (`cd tests/firestore-rules && npm install && npm run test:exec`, 35 testes) → backup → `firebase deploy --only firestore:rules` (fora de sessão ativa da esposa) → smoke test. Sign-up já está OFF; chave Anthropic: rotação pendente.
