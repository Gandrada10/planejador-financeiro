# Caracterização da importação

Fixa o que o `ImportModal` faz hoje (mapeamento, datas de compra e de
vencimento, parcelas futuras, os critérios de duplicata, reembolsos) para que
mover essa lógica para `src/lib/` não mude nada.

- `golden.json`: o resultado do **master**, com dados sintéticos
  (`fixtures.mjs`). Nada aqui vem de fatura real.
- `npm run test:import`: compara a árvore de trabalho com o golden, pelo
  componente inteiro (montado num mini-runtime de hooks, `stubs/`, sem
  navegador) e por cada função pura.
- `run.mjs --ref <commit>`: roda um commit qualquer contra o golden.
  `--write-golden` regrava o golden, e só a partir de um commit.
- `compare-real.mjs`: roda uma leitura real (resposta da IA ou OFX) e um
  backup pelo código do master e pelo da árvore de trabalho e diz se saem
  iguais. Não imprime descrição nem valor, não grava nada. Ver o cabeçalho.

A leitura por IA (`/api/parse-statement`) é substituída por uma resposta
fixa: ela não é determinística, e o que se compara é tudo o que vem depois
dela. Nenhum teste faz rede (o `fetch` falso recusa qualquer outro endereço).

As datas do app são locais (meio-dia), então o fuso entra no resultado:
rode sempre com `TZ=America/Sao_Paulo` (o script do npm já faz isso).
