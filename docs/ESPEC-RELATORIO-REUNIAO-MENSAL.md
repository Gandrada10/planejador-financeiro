# Especificação — relatório da reunião financeira do casal (v8)

Outubro de 2026. Substitui o desenho do `relatorio-executivo-agosto-2026-v7.pdf`.

Este documento diz **o que** o relatório mede, **como** cada número é
calculado e **em que ordem** ele é apresentado. Vale para qualquer gerador
(o PDF do app em `src/lib/pdf/` ou o cockpit). Onde o dado ainda não existe no
app, a seção 9 diz o que falta criar.

---

## 1. O que muda em relação à v7

A v7 tem bom esqueleto editorial e boa honestidade metodológica, e isso fica.
O que muda:

| Problema na v7 | Na v8 |
|---|---|
| Manchete conclusiva sobre dados que o próprio relatório declara incompletos | Portão de fechamento (seção 5). Mês não fechado sai como **PRELIMINAR**, sem manchete conclusiva |
| "Custo de vida" de R$ 47 mil inclui viagem à Europa e obra | Três números distintos: custo essencial, custo de vida, gasto total (seção 2) |
| Déficit de 41% em 12 meses sem dizer de onde veio o dinheiro | Ponte do resultado: aportes, resgates e variação de saldo (seção 2.4) |
| Média de receita esconde renda que vai de R$ 17 mil a R$ 73 mil | Receita recorrente separada da eventual; mediana e piso ao lado da média |
| Base de data não declarada (compra ou vencimento?) | Uma base só, declarada no rodapé de toda página (seção 2.5) |
| Só fluxo de caixa | Reserva, patrimônio, dívidas, parcelas futuras, metas |
| Reunião começa sem olhar o que foi combinado na anterior | Página 2 é o acompanhamento das decisões anteriores |
| Decisões como perguntas abertas | Decisões com opções quantificadas |
| Vocabulário de auditoria na mesa da família | Estado dos dados num selo + apêndice |

---

## 2. Conceitos e definições

### 2.1 As camadas do gasto

O erro intuitivo é tratar "custo de vida" como "só o que é fixo". Remédio,
mercado e combustível variam de valor, mas existem todo mês, e fingir que não
existem subestima o custo de viver. O que separa um gasto do outro não é
**fixo × variável** (é o valor que muda?), e sim dois eixos diferentes:

- **Recorrência:** o gasto se repete (todo mês, ou todo ano) ou é pontual?
- **Essencialidade:** a família consegue ficar sem ele por alguns meses?

Disso saem quatro camadas, e cada lançamento de despesa pertence a uma só:

| Camada | O que é | Exemplos |
|---|---|---|
| **1. Fixo** | Recorrente, valor contratado, essencial | Aluguel/condomínio, escola, plano de saúde, seguros, financiamento |
| **2. Essencial variável** | Recorrente, valor varia, essencial | Mercado, farmácia, combustível, luz/água/gás, transporte |
| **3. Discricionário** | Recorrente, dá para cortar | Restaurante, delivery, lazer, vestuário, assinaturas, cuidados pessoais, compras do dia a dia |
| **4. Extraordinário** | Pontual, planejado ou não | Projetos (viagem grande, obra), troca de carro, eletrodoméstico, conserto relevante |

As camadas se acumulam em três números, e são esses que o relatório usa:

```
Custo essencial  = camada 1 + camada 2              → dimensiona a reserva de emergência
Custo de vida    = camada 1 + camada 2 + camada 3   → o padrão de vida; dimensiona a independência financeira
Gasto total      = camadas 1 a 4                    → o que saiu de fato (os R$ 47 mil da v7)
```

- **Custo essencial** responde: "se a renda parar, quanto precisamos por mês?"
- **Custo de vida** responde: "quanto custa viver como vivemos hoje?"
- **Gasto total** responde: "quanto gastamos, incluindo o que não se repete?"

**Despesas anuais** (IPVA, IPTU, seguro do carro, matrícula, material
escolar) são recorrentes, só que uma vez por ano. Pertencem à camada 1 ou 2.
Elas fazem o mês em que caem parecer caro; por isso todo custo do relatório é
apresentado também como **média móvel de 12 meses**, que dilui essas despesas
no ano. A média de 3 meses mostra tendência; a de 12, nível.

### 2.2 Receitas

O mesmo problema existe do lado da entrada:

| Tipo | O que é | Exemplos |
|---|---|---|
| **Receita recorrente** | Entra todo mês, com valor previsível | Salário, pró-labore, aluguel recebido |
| **Receita eventual** | Real, mas sem data ou valor previsível | Bônus, PLR, 13º, distribuição de lucros, freelas |
| **Não é receita** | Dinheiro que já era da família trocando de forma | Resgate de investimento, empréstimo tomado, venda de bem, reembolso |

Resgate de investimento **não é receita**, assim como aporte **não é
despesa**. Os dois são movimentação patrimonial e ficam fora dos totais (como
a categoria Transferência já faz), mas são **rastreados** à parte, porque são
eles que explicam o resultado (seção 2.4).

Renda irregular exige mais que a média. O relatório mostra, para os últimos
12 meses: média e mediana da receita total, média da receita recorrente, e o
**piso** (menor receita recorrente mensal). Gasto fixo deve caber no piso;
receita eventual deve ir para reserva, metas e projetos, não para o custo de
vida.

### 2.3 Resultado e taxa de poupança

```
Resultado do mês   = receita (recorrente + eventual) − gasto total
Taxa de poupança   = resultado ÷ receita
```

Ambos sobre a mesma base de data (2.5) e com as mesmas exclusões
(`countsInTotals`).

### 2.4 Ponte do resultado

Resultado negativo significa que a família consumiu patrimônio. A pergunta
seguinte é sempre **de onde**, e o relatório responde:

```
Resultado do mês
  = aportes em investimentos − resgates de investimentos
  + variação do saldo das contas correntes
  − variação da dívida (fatura em aberto, empréstimos)
  + diferença não explicada
```

A "diferença não explicada" é um indicador de qualidade dos dados: quando ela
é grande, falta lançamento ou há classificação errada. No caso da v7 (−R$ 165
mil em 12 meses), essa ponte teria mostrado se o dinheiro saiu de resgates,
do saldo em conta, ou se a receita está sub-registrada.

Enquanto o app não tiver saldos de conta (seção 9, fase 3), a ponte mostra só
aportes e resgates, e o restante aparece como "variação de caixa e dívida,
não medida".

### 2.5 Base de data

O relatório usa uma base só: **caixa** (`accountingDate`, que num lançamento
de cartão é o vencimento da fatura e num extrato é a data do lançamento).
Motivos:

- É a base que fecha com o saldo das contas e com a ponte do resultado.
- É a que o app já usa no custo de vida (`src/lib/costOfLiving.ts`) e nos
  orçamentos.
- Parcelas caem no mês em que são pagas, que é o que o orçamento precisa ver.

O rodapé de toda página diz: *"Valores pela data de pagamento: compras no
cartão contam no mês de vencimento da fatura."* A data da compra
(`purchaseDate`) não é usada em nenhum total do relatório.

---

## 3. Classificação: como cada lançamento recebe sua camada

### 3.1 A camada é atributo da categoria, não do lançamento

Cada categoria de despesa ganha um campo `nature`:
`'fixo' | 'essencial' | 'discricionario'`. A camada 4 não é natureza de
categoria (seção 3.3).

- A **subcategoria herda** a natureza da categoria-mãe, a menos que tenha a
  sua. É isso que permite Alimentação ter Mercado (essencial) e Restaurante
  (discricionário).
- Categoria sem natureza definida entra como **discricionário** e aparece no
  portão de fechamento como pendência. O padrão conservador evita inflar o
  custo essencial e, portanto, subdimensionar a reserva.
- Categorias com `excludeFromTotals` não têm natureza.

### 3.2 O caso "Compras"

"Compras" não pode ter natureza única porque descreve o **canal**
(Amazon, Mercado Livre, loja), não o **propósito**. Uma compra na Amazon pode
ser remédio, fralda, roupa ou televisão. Em agosto, Compras somou R$ 10 mil
(27% das despesas) e é justamente a categoria que a reunião não consegue
interpretar.

A correção é na árvore de categorias, não no relatório:

- Reclassificar por propósito. O remédio comprado na Amazon vai para Saúde, a
  fralda para Casa ou Filhos.
- O que sobrar em Compras ganha subcategorias por propósito, cada uma com
  natureza própria, por exemplo:
  - Compras › Casa e utilidades → essencial
  - Compras › Vestuário → discricionário
  - Compras › Eletrônicos e equipamentos → discricionário (ou extraordinário,
    seção 3.3, quando for item de valor alto)

O mesmo raciocínio vale para qualquer categoria que misture propósitos.

### 3.3 Extraordinário (camada 4)

Um lançamento é extraordinário se:

1. tem `projectId` (viagem Europa, obra), **ou**
2. foi marcado como extraordinário no próprio lançamento (campo novo
   `extraordinary: boolean`), para pontuais sem projeto, como uma geladeira
   nova.

Extraordinário sai do custo de vida e do custo essencial, mas entra no gasto
total e no resultado. A categoria continua valendo para o detalhamento: a
geladeira é "Casa" e extraordinária ao mesmo tempo.

Regra prática para a marcação: valor acima de um limiar (sugestão: R$ 2.000)
**e** não se repete nos últimos 12 meses. O app pode sugerir a marcação no
fechamento; quem decide é o casal.

### 3.4 Receitas e movimentação patrimonial

- Categorias de receita ganham `incomeKind: 'recorrente' | 'eventual'`.
- Sob a categoria de transferência (já excluída dos totais), criar
  subcategorias com o campo `patrimonialFlow: 'aporte' | 'resgate'`:
  "Aporte em investimento" e "Resgate de investimento". Continuam fora dos
  totais, mas alimentam a ponte do resultado (2.4).

---

## 4. Indicadores

Todos calculados sobre a base de caixa. "12m" é a janela móvel encerrada no
mês do relatório. As faixas são convenções de mercado e da literatura
(Greninger, Hampton e Kitt, 1996), e devem ser **configuráveis**: são ponto
de partida, não verdade.

| Indicador | Fórmula | Verde | Amarelo | Vermelho |
|---|---|---|---|---|
| Taxa de poupança (12m) | resultado 12m ÷ receita 12m | ≥ 20% | 10–20% | < 10% |
| Cobertura do custo de vida | receita recorrente média 12m ÷ custo de vida médio 12m | ≥ 1,2 | 1,0–1,2 | < 1,0 |
| Reserva de emergência | saldo de liquidez imediata ÷ custo essencial médio 12m | ≥ 6 meses | 3–6 | < 3 |
| Comprometimento com parcelas | parcelas de cartão e empréstimos do mês ÷ receita recorrente média 12m | ≤ 15% | 15–30% | > 30% |
| Aderência ao orçamento | custo de vida do mês ÷ orçamento do mês | ≤ 100% | 100–110% | > 110% |
| Patrimônio líquido | ativos − dívidas, variação real em 12m (descontado o IPCA) | > 0 | ≈ 0 | < 0 |

Números de apoio, sem semáforo: custo essencial, custo de vida e gasto total
(mês, média 3m, média 12m, mediana 12m); receita total, recorrente e piso;
parcelas futuras já contratadas (soma das parcelas restantes de cada compra
parcelada, pela última parcela registrada de cada uma).

O semáforo compara com uma **meta**, nunca com o próprio sinal. Vermelho
significa "fora da faixa combinada", e não "número negativo".

---

## 5. Portão de fechamento

Antes de gerar o relatório, o gerador verifica o mês e classifica o
relatório como **FECHADO** ou **PRELIMINAR**:

| Verificação | Critério para FECHADO |
|---|---|
| Contas com lançamento | Toda conta ativa (corrente e cartão) tem ao menos um lançamento no mês, ou foi marcada "sem movimento" |
| Faturas | Todo `billingCycle` do mês está `closed` |
| Despesas sem categoria | Zero (lançamento sem categoria conta nos totais e distorce todos os indicadores) |
| Receitas sem categoria | Zero |
| Categorias sem natureza | Zero entre as usadas no mês |
| Ponte do resultado | Diferença não explicada abaixo de 5% da receita do mês (quando houver saldos) |

Relatório **PRELIMINAR**:

- selo "PRELIMINAR" no topo de toda página;
- a capa não tem manchete conclusiva; diz "Agosto ainda não fechado: N
  pendências" e lista as três maiores;
- os indicadores aparecem, mas sem semáforo.

**Meta de processo:** mês fechado até o dia 10 do mês seguinte, reunião até o
dia 15. A v7 de agosto foi lida em 2 de outubro ainda em aberto; com esse
atraso, a reunião discute um mês que já não pode ser corrigido.

---

## 6. Relatório mensal, página a página

Formato A4 retrato, 7 páginas e um apêndice. **Mesma estrutura todo mês**: o
mesmo indicador no mesmo lugar permite comparar relatórios lado a lado. A
manchete muda, a posição dos elementos não.

### Página 1 — Painel

O que responde: "estamos bem?"

- Cabeçalho: mês, selo FECHADO/PRELIMINAR, data de geração.
- **Manchete** de uma linha com o achado principal (só se FECHADO).
- **Seis cartões de indicador** (seção 4), cada um com: valor, meta, semáforo
  e minigráfico (sparkline) dos últimos 12 meses.
- **Cascata do mês** (gráfico waterfall): receita recorrente + receita
  eventual → menos fixo → menos essencial variável → menos discricionário →
  menos extraordinário → resultado. É o gráfico que mais explica numa só
  imagem: mostra quanto da renda vai para cada camada e o que sobra.

### Página 2 — O que combinamos

O que responde: "fizemos o que decidimos na reunião anterior?"

- Tabela das decisões da reunião anterior: decisão, responsável, prazo,
  status (feito / em andamento / não feito) e, quando a decisão tem número,
  o número medido. Ex.: "teto de R$ 2.500 em Restaurante → realizado
  R$ 2.910 (+16%)".
- Decisões sem número aparecem com status declarado na reunião.

### Página 3 — O mês contra o orçamento

O que responde: "onde o mês saiu do planejado?"

- Tabela agrupada por camada (Fixo, Essencial variável, Discricionário), com
  uma linha por categoria: orçado, realizado, desvio em R$ e %, média 12m.
- **Gráfico de bala** (bullet chart) por linha: barra do realizado sobre a
  faixa do orçado. É o formato padrão para realizado × meta.
- Ordenação dentro de cada camada pelo **desvio em R$**, não pelo valor.
- Subtotal por camada. Destaque (negrito, cor) só nas linhas fora da faixa.
- Extraordinários **fora** desta tabela: listados à parte, um por linha, com
  projeto ou descrição.
- Sem orçamento cadastrado, a coluna "orçado" usa a média 12m com o rótulo
  "referência: média 12m (sem orçamento)", e a página 7 traz a criação do
  orçamento como decisão.

### Página 4 — Tendência de 12 meses

O que responde: "o padrão está subindo ou descendo?"

- **Barras empilhadas** por mês com as quatro camadas, e a receita como linha
  sobreposta. Substitui o gráfico de linhas receita × despesa da v7: mostra
  não só que se gastou mais, mas em qual camada.
- Anotações nos picos ("mar: bônus anual", "mai: Europa"). Um pico sem
  explicação leva a reunião a discutir o gráfico em vez da decisão.
- Tabela-resumo:

  | | Mês | Média 3m | Média 12m | Mediana 12m |
  |---|---|---|---|---|
  | Custo essencial | | | | |
  | Custo de vida | | | | |
  | Gasto total | | | | |
  | Receita total | | | | |
  | Receita recorrente | | | | |

- Linha do piso de receita recorrente no gráfico.

### Página 5 — Reserva, patrimônio e dívidas

O que responde: "o colchão e o patrimônio estão onde deveriam?"

- Reserva de emergência: saldo, meses de custo essencial cobertos, meta.
- Patrimônio líquido: valor e evolução de 12 meses (linha).
- **Ponte do resultado** (2.4): do resultado do mês até aportes, resgates e
  variação de saldo, também em cascata.
- Parcelas futuras: total já contratado e o quanto vence em cada um dos
  próximos 6 meses (barras), para ver o comprometimento que já existe antes
  de qualquer compra nova.

### Página 6 — Projetos e próximos 90 dias

O que responde: "o que vem pela frente que já sabemos?"

- Projetos ativos: orçamento, executado, **restante a executar**, prazo, e
  semáforo de estouro. Projeto com prazo vencido e ainda ativo vira pendência
  de cadastro (como a Europa 2026 na v7).
- Despesas conhecidas dos próximos 3 meses: parcelas, despesas anuais
  (IPVA, IPTU, seguros, matrículas) e saídas de projetos previstas. Na
  primeira versão, as anuais são estimadas pelo mesmo mês do ano anterior,
  com o rótulo "estimativa"; depois, por um calendário cadastrado (seção 9).
- Projeção do resultado dos próximos 3 meses: receita recorrente − custo de
  vida médio − extraordinários conhecidos.

### Página 7 — Decisões

O que responde: "o que vamos mudar?"

- Data, participantes.
- Até três decisões propostas, cada uma com **contexto numérico** e
  **opções quantificadas**. Exemplo (valores ilustrativos):

  > **Fechar o déficit recorrente de R$ 7 mil/mês**
  > A. Cortar 30% do discricionário (−R$ 3,8 mil) e adiar a segunda fase da
  > obra (−R$ 3,2 mil/mês por 6 meses).
  > B. Manter o padrão e cobrir com resgates: consome R$ 84 mil em 12 meses,
  > a reserva cai de 8 para 4 meses.
  > C. Outra: ________

- Espaço para decisão escolhida, responsável e prazo, e o **número que
  medirá** a decisão na próxima página 2 (ex.: "teto de Restaurante:
  R$ 2.500").

### Apêndice — Dados e definições

- Estado do fechamento (seção 5), com a lista completa de pendências.
- Definições das camadas e dos indicadores, em uma página fixa.
- Base de data e exclusões.

---

## 7. Reuniões trimestral e anual

Não são relatórios separados: são o relatório mensal do último mês do
período com páginas a mais, inseridas antes da página de decisões.

### Trimestral (março, junho, setembro, dezembro)

- **Revisão do orçamento:** por categoria, orçado × média dos 3 meses.
  Categoria que estoura todo trimestre tem orçamento irreal: ajustar o
  orçamento ou o comportamento, por decisão explícita.
- **Metas:** progresso de cada meta de acumulação (valor atual, alvo, prazo)
  e projeção "no ritmo dos últimos 3 meses, a meta é atingida em ___".
- **Trimestre contra o mesmo trimestre do ano anterior**, por camada.
- **Calendário dos próximos 6 meses.**

### Anual (dezembro ou janeiro)

- **Balanço patrimonial:** ativos (por classe), dívidas, patrimônio líquido,
  comparados com o ano anterior, em valor nominal e real.
- **Demonstrativo do ano:** receita por tipo, gasto por camada e por
  categoria, resultado, taxa de poupança anual.
- **Orçamento do ano seguinte:** por categoria e mês, com reajuste pela
  inflação e as despesas anuais nos meses em que caem.
- **Metas do ano seguinte**, com valor e prazo.
- **Independência financeira:** patrimônio necessário = custo de vida anual ÷
  taxa de retirada real (convenção de 3% a 4% ao ano; usar o limite inferior
  para o Brasil, por prudência), patrimônio atual, distância e prazo no ritmo
  de poupança atual.
- **Riscos e proteção:** checklist de seguros (vida, invalidez, saúde,
  residencial, auto), valores segurados contra o custo essencial.
- **Impostos:** documentos do IR, simplificado × completo, previdência
  (PGBL), despesas dedutíveis do ano (saúde e educação saem das categorias).
- **Sucessão e acesso:** beneficiários, testamento, quem tem acesso a quê se
  um dos dois faltar.

---

## 8. Design

O design da v7 é bom e o sistema visual fica: título em serifa afirmando o
achado, paleta azul-marinho e cinza, muito branco, tabelas sem grade pesada.
Não há motivo para recomeçar. As mudanças são de **função**, não de estilo:

1. **Estrutura fixa.** Mesmas páginas, mesmos blocos nas mesmas posições,
   todo mês. Relatório de reunião é lido em série, e comparabilidade vale mais
   que variedade.
2. **Cor com significado único.** Vermelho só para "fora da meta". Na v7 o
   vermelho marca tanto número negativo quanto "maior alta", e o leitor não
   sabe o que é alarme. Uma cor por camada (fixo, essencial, discricionário,
   extraordinário), a mesma em todos os gráficos.
3. **Gráficos com uma pergunta cada.** Cascata para "para onde foi a renda",
   barras empilhadas para "qual camada cresceu", bala para "realizado ×
   orçado", sparkline para "tendência de cada indicador". Linha de receita ×
   despesa sozinha não responde nenhuma delas bem.
4. **Arredondar para ler, detalhar para conferir.** Manchetes, cartões e
   gráficos em R$ mil com uma casa (R$ 47,0 mil). Centavos só nas tabelas.
   "R$ 47.017,86" num cartão de destaque obriga a ler sete algarismos para
   extrair um número.
5. **Menos texto corrido.** Cortar as frases de transição de rodapé ("a página
   seguinte mostra..."). Comentário só quando explica um número, e ao lado
   dele.
6. **Anotar os picos** nos gráficos de série, em vez de explicar em parágrafo.
7. **Estado dos dados num selo**, não em parágrafos espalhados. Detalhe no
   apêndice.
8. **Página de decisões que funciona impressa**: opções com caixa de marcar,
   linhas para responsável, prazo e número de acompanhamento.

---

## 9. Dados: o que existe e o que falta

| Necessidade | Situação no app | O que fazer |
|---|---|---|
| Lançamentos, categorias, subcategorias | Existe | — |
| Exclusão dos totais | Existe (`excludeFromTotals`, `countsInTotals`) | — |
| Base de caixa | Existe (`accountingDate`) | — |
| Natureza da despesa (camadas 1–3) | Não existe | Campo `nature` em `Category`, com herança da mãe |
| Extraordinário | Parcial: `projectId` existe | Campo `extraordinary` em `Transaction` |
| Tipo de receita | Não existe | Campo `incomeKind` em `Category` |
| Aportes e resgates | Não distinguidos (tudo "Transferência") | Subcategorias com `patrimonialFlow` |
| Orçamento mensal por categoria | Existe (`budgets`, `ExpenseGoalsTab`), mas não preenchido | Preencher; o relatório passa a usá-lo |
| Projetos com orçamento e prazo | Existe (`Project.budget`, `endDate`) | Campo "restante a executar" é derivado |
| Parcelas futuras | Derivável (`installmentNumber`, `totalInstallments`) | Cálculo no gerador |
| Faturas fechadas | Existe (`billingCycles.status`) | — |
| Saldos de contas e investimentos | Não existe | Coleção `balanceSnapshots`: conta, data, saldo (lançado à mão no fechamento ou extraído do extrato) |
| Dívidas (empréstimos, financiamentos) | Não existe | Conta tipo `divida` com saldo em `balanceSnapshots` |
| Metas de acumulação | Não existe (projetos são de gasto) | Coleção `goals`: nome, alvo, prazo, contas vinculadas |
| Decisões das reuniões | Existe no cockpit (ata em nota do vault) | Coleção `meetings` com decisões estruturadas (texto, responsável, prazo, métrica, status), ou manter no cockpit com o mesmo formato |
| Calendário de despesas anuais | Não existe | Coleção `scheduledExpenses`: descrição, valor estimado, mês, categoria |
| Limiares do semáforo | Não existe | Configuração por usuário com os padrões da seção 4 |

---

## 10. Ordem de implementação

Cada fase entrega um relatório melhor que o anterior, sem depender da
seguinte.

1. **Classificação.** Campos `nature`, `incomeKind`, `extraordinary`,
   `patrimonialFlow`; revisão da árvore de categorias (começando por
   Compras); portão de fechamento. Já permite os três custos, a receita
   recorrente, a cascata e a página 4.
2. **Orçamento.** Preencher os orçamentos mensais (os dados de 12 meses dão o
   ponto de partida) e montar a página 3 com gráficos de bala.
3. **Patrimônio.** `balanceSnapshots` e contas de dívida. Libera reserva,
   patrimônio líquido e a ponte completa (página 5).
4. **Ritual.** Decisões estruturadas (páginas 2 e 7), metas e calendário de
   despesas anuais (página 6).
5. **Trimestral e anual** (seção 7).

Toda mudança de regra de cálculo (camadas, ponte, parcelas futuras) deve ser
validada contra um backup real, como indicado no `CLAUDE.md`, medindo se os
totais por camada somam o gasto total e se a ponte fecha.

---

## 11. Questões em aberto

- **Qual gerador?** A v7 parece vir do cockpit (`tools/mypka`), não do
  `src/lib/pdf/` do app. A especificação vale para os dois, mas a
  implementação deve ficar num só, para não haver dois números de custo de
  vida.
- **Origem do déficit de R$ 165 mil** em 12 meses: resgate, saldo em conta ou
  receita sub-registrada? A resposta define se a fase 1 já inclui a ponte.
- **Limiares:** os da seção 4 são padrão de mercado. Taxa de poupança e meses
  de reserva devem refletir o perfil da família (renda irregular pede reserva
  maior).
- **Limiar de extraordinário** (sugestão: R$ 2.000 e não recorrente em 12
  meses).
