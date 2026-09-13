# Validação da entrega

Validação local em **13/09/2026**, Windows, Node.js **22.22.0**, VS Code **1.118.1**, AMX Mod X Compiler **1.10.0.5481**.

## Cobertura

| Verificação                         | Resultado                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript estrito                  | Sem erros de tipos.                                                                                                                        |
| Testes unitários e gramática        | 50 testes aprovados: lexer, formatação, seleção, parser, processos, worker e gramática TextMate/Oniguruma.                                 |
| VS Code real, perfil isolado        | Ativação, documento/seleção, idempotência, completion, ciclos/includes não salvos, definição, hover, assinatura, outline e links.          |
| Compilador pelo comando da extensão | Plugin válido gera `.amxx`; falha publica Problems e preserva o binário anterior; edição remove diagnóstico obsoleto.                      |
| Restricted Mode                     | Formatação funciona; comando de compilação retorna sem executar o compilador.                                                              |
| Corpus privado autorizado           | 24 plugins: 7 de `classes`, 10 de `addon`, 7 de `core`; 191.705 bytes.                                                                     |
| Integridade dos originais privados  | SHA-256 comparado antes/depois: nenhum arquivo modificado.                                                                                 |
| Corpus privado: formatação          | 24 processados em 4 configurações, 96 verificações sem falha, sem recusas ou diferenças de tokens/assinaturas; segunda formatação estável. |
| SDK oficial: includes               | 66 includes, 1.080.915 bytes, 264 verificações nas mesmas 4 configurações, sem falhas.                                                     |
| SDK oficial: compilação             | 21 plugins e 66 includes formatados nas cópias. Todos os `.amxx` antes/depois são idênticos byte a byte com `-d0`.                         |

O VSIX foi extraído em `.tools/packaged-extension` e a suíte de integração também foi executada contra seus bundles de produção, nos modos confiável e restrito. A inspeção do pacote confirmou a presença do worker e das fontes e a ausência de SDK, plugins privados e dependências de desenvolvimento.

Os plugins privados foram usados apenas para testes de formatação e indexação, sem compilar ou executar o projeto original. Os snapshots, caminhos e hashes individuais ficam em `.tools/private-corpus/report.json`, fora do Git e do VSIX. O corpus oficial e os resultados do compilador ficam em `.tools/compiler-tests` e `.tools/sdk-include-corpus`. As configurações verificadas foram Allman com 4 espaços, Allman com 2 espaços, Allman com tabs e preservação da posição das chaves com 4 espaços.

## Desempenho

O benchmark envia um arquivo sintético de **190.890 bytes**, contendo **2.000 funções**, ao worker empacotado. São 10 amostras após o aquecimento; o tempo inclui a comunicação com o worker. A última medição dos bundles de produção nesta máquina foi **63,72 ms de mediana**, **78,33 ms no percentil 90** e **20,61 ms de startup**. Valores variam conforme hardware e carga; o resultado da execução fica em `artifacts/benchmark.json`.

Não são números de latência de um servidor remoto nem garantia de desempenho em qualquer arquivo. Há limites de tamanho, profundidade, fila, cache e includes. A seleção também é processada no worker.

## Limites da evidência

Igualdade de tokens e idempotência não provam o comportamento de macros arbitrárias. A igualdade binária foi testada no corpus oficial com `-d0`; com debug, números de linha normalmente mudam ao formatar. O parser é sintático e não substitui o compilador para tipos, branches condicionais ou expansão de macros.

O workflow inclui testes unitários em Windows, Linux e macOS e testes de extensão/compilador em Windows. Nesta entrega foram executados localmente os testes de Windows; a execução futura do CI não é apresentada como já realizada.

## Reproduzir

Veja os comandos de setup do SDK, corpus, integração e benchmark no README. Use `npm run validate` para a verificação local básica e `npm run package` para gerar o VSIX. Os perfis de integração ficam separados em `.vscode-test`; a extensão antiga e o perfil principal do usuário permanecem intactos.
