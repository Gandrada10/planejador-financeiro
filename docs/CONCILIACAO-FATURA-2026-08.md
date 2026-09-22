# Conciliação — fatura Latam Pass Itaú Black final 4640, Agosto/2026

**Data:** 22/09/2026 · **Escopo:** a fatura de 08/2026 do cartão `Latampass Black` contra o XLSX emitido pelo Itaú e contra a base (4.868 transações).

Registro do caso que motivou o fix do dedupe em `ImportModal.tsx` (PR #52). Serve de referência para a próxima vez que uma fatura não fechar.

---

## O sintoma

A aba Cartões fechou agosto em **R$ 8.307,90**. O banco cobrou **R$ 9.322,42**. A fatura em si está íntegra: as 139 linhas de lançamento somam exatamente o valor do cabeçalho.

## O diagnóstico

Dois erros em sentidos opostos, ambos do mesmo `findDuplicate`:

| | linhas | valor |
|---|---|---|
| Parcelas legítimas suprimidas como "duplicata" | 16 | R$ 2.043,53 |
| Duplicatas reais que passaram e foram gravadas | 11 | R$ 1.029,01 |
| **Diferença líquida** | | **R$ 1.014,52** |

### Falso positivo — as 16 parcelas

O Itaú **repete a data da compra original** em toda parcela seguinte. A `Parcela 5 de 6` do Airbnb em agosto (R$ 688,13, data 14/03/2026) é idêntica à `Parcela 4 de 6` de julho em valor, descrição e data — só o número da parcela difere. O critério não olhava esse campo, então cada parcela do mês era marcada como duplicata da fatura anterior, entrava **desmarcada** e nunca era gravada. Todas as 16 têm gêmea exata em julho.

### Falso negativo — as 11 duplicatas

O critério exigia descrição byte a byte igual. Mas o extrato trunca o nome do estabelecimento em larguras diferentes conforme a seção, e a leitura por IA transcreve a mesma linha de formas diferentes a cada importação:

```
"ELUBEL INDUSTRIA"        vs  "Elubel Industria Ecotia"
"ZIG*ZIGPAY"              vs  "Zig* *Zigpay"
"BRAZL COMERCIO DE AL"    vs  "Brazrio Comercio De Al"
"CONQUISTA CONTROLE E P"  vs  "Conquista Controle E Pr"
```

Houve duas importações da mesma fatura (`import_1785803731174`, 102 linhas; `import_1790039639537`, 32 linhas). A segunda não reconheceu as próprias linhas da primeira e gravou tudo de novo.

## O que NÃO era o problema

Duas hipóteses foram levantadas e descartadas com evidência:

- **Rateio por titular errado.** O desvio (Juliana +R$ 303,29, Guilherme −R$ 1.317,81) é consequência aritmética exata das 16 linhas faltando e das 11 sobrando. Recalculado, fecha em R$ 0,00 nos dois membros. Não há misatribuição.
- **A fatura de julho estar inflada.** Julho está correto: 133 linhas somando exatamente R$ 9.633,97, o valor real da fatura. O "Saldo anterior" de R$ 1.611,49 vem da **baixa do pagamento**, registrada como R$ 8.022,48 em vez de R$ 9.633,97. É dado de entrada, não bug.

Resíduo cosmético: 47 linhas gravadas com `cardNumber` 4640 onde a fatura diz 4535. Não afeta total nem rateio — o agrupamento é por membro cadastrado (`familyMember`), que está certo.

## Como fica depois da limpeza

```
8.307,90 + 2.043,53 (16 parcelas) − 1.029,01 (11 duplicatas) = 9.322,42
```

## Armadilha na hora de verificar

O critério antigo depende da descrição, e a leitura por IA **não é determinística**: duas importações do mesmo arquivo produziram descrições diferentes e, com elas, 1 e 118 duplicatas detectadas. O critério novo ignora a descrição na fatura, então o resultado é estável — e o resultado correto para esta fatura é sempre **123 duplicatas / 16 selecionadas**.

Qualquer outro número no preview significa que o navegador está servindo bundle antigo (o app tem service worker). O balão do ⚠ diz qual critério rodou: "data da compra, valor e parcela" é o novo; "data, valor e descrição" é o antigo.

## Lição para o dedupe

Numa fatura de cartão a descrição é o campo **menos** confiável — é transcrição, não dado. A identidade da linha é `conta + data da compra + valor + parcela`. E dedupe é questão de **contagem**, não de existência: a fatura repete cobranças legítimas (duas passagens de metrô de R$ 7,90 no mesmo dia), e perguntar "existe alguma igual?" descarta a segunda para sempre.
