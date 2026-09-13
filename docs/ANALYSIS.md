# Análise da extensão de referência

A análise utilizou a instalação local de `abhinash.amxxpawn-language-0.7.6`. Nenhum arquivo dessa instalação foi alterado.

| Área         | Referência 0.7.6                                                     | Revo Pawn                                                                                         |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Plataforma   | VS Code `^1.11.0`, TypeScript `^2.0.3`, tipos Node 6                 | VS Code `^1.95.0`, TypeScript estrito, build esbuild para Node 20 do host                         |
| Runtime      | `vscode-languageclient`/`vscode-languageserver` 3.3 e `vscode-uri` 1 | API nativa do editor, worker Node separado, sem dependências externas de runtime                  |
| Ativação     | Servidor filho com `--inspect=5858` mesmo em execução normal         | Worker iniciado sob demanda, sem porta de depuração em produção                                   |
| Arquivos     | Watcher `**/*.*`, leituras e verificações síncronas                  | Watcher limitado a `.sma`/`.inc`, I/O assíncrono, busca apenas na árvore de includes              |
| Configuração | `amxxpawn.*`, dependência do workspace root global                   | `revo_pawn.*`, configuração por recurso e pasta de workspace                                      |
| Edição       | Completion, definição, hover, assinaturas, outline e links           | Recursos equivalentes, folding, includes não salvos e snippets novos                              |
| Formatação   | Nenhum provedor anunciado                                            | Lexer lossless, planejamento estrutural, documento e seleção                                      |
| Compilação   | `spawn`, acúmulo de stdout e parsing legado                          | Processo direto, stdout/stderr, timeout/cancelamento, escrita temporária e diagnóstico com código |
| Manutenção   | Bundle instalado sem infraestrutura de testes presente               | Fonte, lockfile, testes reproduzíveis, CI, documentação e VSIX                                    |

O cliente antigo ainda chamava `workspace.rootPath` e não registrava todos os listeners no ciclo de descarte. A nova implementação vincula os recursos a `context.subscriptions` e observa o workspace do arquivo para resolver caminhos.

## Decisões

Uma extensão exclusiva para VS Code não precisa de um processo LSP para oferecer esses recursos. Os provedores nativos simplificam a integração e eliminam as dependências antigas. A análise e a formatação executam em um worker para evitar trabalho pesado na thread principal do Extension Host. O protocolo do worker é pequeno e tipado; erros, timeout e descarte liberam solicitações pendentes.

O parser fornece indexação sintática para navegação e sugestões. Não emite diagnósticos semânticos inventados: esses vêm do `amxxpc`. Não há expansão completa de macros nem seleção de branches condicionais; definições de ramos alternativos podem aparecer em sugestões.

O formatador mantém a sequência exata de tokens, preserva as fronteiras originais entre linhas de instruções e só insere quebras em pontos estruturais. Isso evita tratar Pawn como C ou JavaScript, especialmente em código sem ponto e vírgula. Literais e diretivas ficam opacos. Em casos que não podem ser tratados com segurança, ele não altera o documento e registra o motivo.

O cache tem limite de 128 documentos e 8 MiB de texto de origem retido (um arquivo individual pode ultrapassar esse orçamento até o limite configurado). O worker tem heap limitado e fila limitada; há limites por arquivo, profundidade e número de includes. O consumo real dos objetos do parser é maior que o tamanho do texto e depende da quantidade de tokens.

## Referências técnicas

- [VS Code — Programmatic Language Features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
- [VS Code — Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code — Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [AMX Mod X — lexer e pré-processador do compilador](https://github.com/alliedmodders/amxmodx/blob/master/compiler/libpc300/sc2.c)
- [AMX Mod X — downloads oficiais](https://www.amxmodx.org/downloads-new.php)

As regras de escapes, strings packed/raw, includes e continuações foram conferidas contra o compilador AMXX, além dos testes locais. A gramática visual é TextMate e usa o escape AMXX padrão `^`; mudanças dinâmicas de `ctrlchar` são tratadas pelo núcleo de formatação, mas não reconfiguram a coloração TextMate.
