# Briefing de auditoria — para o time de agentes do MyPKA

**Para:** os agentes de auditoria/análise do MyPKA · **De:** trabalho feito na branch `claude/financial-planner-audit-fnd1tv` · **Data:** 02/07/2026

## Por que você está lendo isto
Um assistente auditou o sistema `planejador-financeiro` e propôs um plano de melhorias. **Antes de implementar qualquer coisa**, o dono quer que este time critique o trabalho. Sua tarefa **não é implementar** — é **pressionar, refutar e priorizar**. Um "está tudo certo" tem pouco valor; o valor está em achar onde o diagnóstico está errado, exagerado, ou desalinhado com o uso real da família.

## O pacote a revisar (tudo nesta branch, em `docs/`)
1. `AUDITORIA-2026-07.md` — os achados, com referências `arquivo:linha`.
2. `PLANO-DE-MELHORIAS.md` — as mudanças propostas, o roadmap em 5 fases e as decisões da conversa (cadência mensal/anual, integração MyPKA, staging, estética).
3. `prototipos/categorizacao-mobile.html` — protótipo navegável da nova tela da esposa (demo isolada, dados fictícios). Abra no navegador.
4. `MELHORIAS-VISUAIS.md` — auditoria visual do app inteiro com o código proposto: tokens de design, receitas de componentes, tema de gráficos validado para daltonismo/contraste e melhorias tela a tela.

Para revisar: `git fetch && git checkout claude/financial-planner-audit-fnd1tv`, depois leia os três arquivos e o código-fonte referenciado em `src/` e `functions/`.

---

## Onde o julgamento de vocês vale MAIS que o meu
Estes pontos eu **não consegui verificar** deste ambiente. São o coração da auditoria de vocês:

1. **As regras do Firestore em produção.** Não existe `firestore.rules` no repo. Toda a severidade do §2.1 depende do que está publicado no console do Firebase. **Verifiquem no console:** as regras estão restritivas (`request.auth.uid == uid`) ou no modo de teste permissivo? Isso muda a prioridade de "crítico" para "já resolvido" ou vice-versa.
2. **Se a dupla contagem de pagamento de fatura (§1.4) realmente acontece.** Ela só ocorre se vocês importam o extrato da conta corrente *além* das faturas dos cartões. Se vocês só importam faturas, o problema não existe. **Confirmem o hábito real de importação.**
3. **O que é código morto de verdade.** Projetos, Pluggy, MigrationMDW — a auditoria assume que estão abandonados. **Vocês usam algum deles?** Remover algo em uso seria um erro.
4. **A precisão do parser de titular/parcelas nas faturas reais.** A auditoria leu a lógica; vocês têm as faturas de verdade. **A extração acerta os titulares dos cartões da família? As parcelas caem na fatura certa?**
5. **Viabilidade da ponte MyPKA no ambiente de vocês.** A service account, a pasta `inbox/`, o cron do Consultor — encaixam na arquitetura atual do MyPKA? Que agente existente assume cada papel?

---

## Perguntas para pressionar, por área

### Sobre os achados (AUDITORIA)
- Algum achado está **factualmente errado** ao reler o código? (cite `arquivo:linha` que refute)
- Algum está **certo, mas irrelevante** para o uso real da família? (rebaixar prioridade)
- Falta algum problema que a auditoria **não pegou**? (bugs, riscos, fricções que vocês sentem no dia a dia)
- A classificação de severidade (crítico/alto/médio) bate com o impacto real?

### Sobre o plano da esposa (Fase 1 + protótipo)
- O bug da sessão `applied` (§1.1) é mesmo o mais grave? A correção proposta cobre todos os cenários de uso irregular dela?
- A sugestão pré-calculada de 1 toque de fato elimina fricção, ou adiciona um passo de "confirmar" que atrapalha quando a sugestão está errada?
- O protótipo está na direção certa de estética e fluidez? O que **removeriam** dele (menos é mais)?
- Falta algo para ela **amar** o processo que nem a auditoria nem o protótipo cobrem?

### Sobre dados confiáveis (Fase 2)
- O campo `kind` + detecção automática na importação é robusto, ou vai gerar classificações erradas que poluem os números de outro jeito?
- O hash de dedupe idempotente (conta+data+valor+descrição+parcela) tem colisões ou falsos positivos plausíveis nas faturas reais?

### Sobre a integração MyPKA (D2)
- Faz sentido dividir app (interface) e MyPKA (back-office)? Ou o upload pelo app deveria continuar sendo o caminho principal?
- Dois caminhos de escrita (app + MyPKA) valem a complexidade, dado que exigem idempotência como pré-requisito?
- Qual agente existente do time assume Extrator e qual assume Consultor de Fechamento?

### Sobre a interface visual (MELHORIAS-VISUAIS)
- A troca da fonte monoespaçada pela sans do sistema + `tabular-nums` perde algo que o dono valorize (identidade "terminal")? Confirmar com ele antes de migrar.
- Os tokens propostos cobrem todos os casos reais das telas, ou alguma tela precisa de um papel que não existe (ex.: terceira cor de status)?
- A estratégia de migração incremental (§6) é segura, ou há acoplamentos de estilo que quebram no meio do caminho?

### Sobre a ordem
- As fases estão na ordem certa de valor/risco? O que vocês fariam **primeiro** de tudo?

---

## Como devolver a crítica
Sugestão de formato para o resultado da auditoria de vocês (para eu incorporar antes de implementar):
- Um arquivo `docs/REVISAO-RESULTADOS.md` na mesma branch (ou comentários no PR), organizado por: **Concordo / Discordo / Falta / Reprioriza**.
- Para cada discordância, **a evidência** (`arquivo:linha`, um print da regra do Firestore, ou o hábito real que contradiz a premissa).
- Uma **ordem de implementação recomendada por vocês**, que pode diferir das fases propostas.

Sejam adversariais. O melhor resultado desta revisão é uma lista de coisas que o plano errou — não uma validação.
