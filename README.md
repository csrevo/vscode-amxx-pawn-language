# Revo Pawn

Extensão para desenvolver plugins **AMX Mod X / Pawn** no VS Code, com formatação de `.sma` e `.inc`, IntelliSense e integração com `amxxpc`.

Projeto reescrito em TypeScript estrito, inspirado nos recursos da extensão **AMXXPawn Language 0.7.6**, de Abhinash/NeO. As configurações e os comandos usam o prefixo **`revo_pawn.`**. O identificador da linguagem continua sendo `amxxpawn`, para manter associações e configurações de editor existentes.

## Instalar

1. No VS Code, desabilite a extensão antiga AMXXPawn Language para evitar provedores duplicados.
2. Execute **Extensions: Install from VSIX...** e selecione `artifacts/revo-pawn-1.0.0.vsix`.
3. Abra um arquivo `.sma` e use **Format Document** (`Shift+Alt+F` no Windows).

Também é possível instalar o pacote pelo terminal:

```powershell
code --install-extension artifacts/revo-pawn-1.0.0.vsix
```

Requer VS Code **1.95 ou superior**. A extensão roda no host da área de trabalho, inclusive Remote SSH/WSL. Em uma sessão remota, os caminhos de compilador e includes devem existir na máquina remota. Não oferece execução em navegador/virtual workspace.

## Configurar

Exemplo para o `settings.json` do projeto ou do usuário:

```json
{
  "revo_pawn.compiler.path": "C:/AMXX/scripting/amxxpc.exe",
  "revo_pawn.language.includePaths": ["${workspaceFolder}/include", "C:/AMXX/scripting/include"],
  "revo_pawn.compiler.outputDirectory": "${workspaceFolder}/compiled",
  "revo_pawn.compiler.arguments": ["-d2"],
  "revo_pawn.format.braceStyle": "allman",
  "[amxxpawn]": {
    "editor.defaultFormatter": "revo.revo-pawn",
    "editor.formatOnSave": true,
    "editor.insertSpaces": true,
    "editor.tabSize": 4
  }
}
```

Para manter tabs, use `"editor.insertSpaces": false`. O formatador recebe `tabSize` e `insertSpaces` do VS Code; ele não impõe espaços a quem usa tabs. O arquivo `examples/settings.json` contém um exemplo completo.

Os caminhos aceitam `${workspaceFolder}`, `${fileDirname}`, `${file}`, `${fileBasenameNoExtension}`, `${env:NOME}` e `~`. Caminhos relativos usam a pasta de workspace do arquivo; sem workspace, usam a pasta do arquivo. Variáveis desconhecidas geram uma mensagem, sem executar comandos de shell.

| Configuração                          | Padrão                    | Função                                                                     |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `revo_pawn.format.enable`             | `true`                    | Formatar documento e seleção.                                              |
| `revo_pawn.format.braceStyle`         | `allman`                  | Chaves de blocos em linhas próprias; `preserve` mantém a posição original. |
| `revo_pawn.format.maxBlankLines`      | `2`                       | Limite de linhas vazias consecutivas.                                      |
| `revo_pawn.format.insertFinalNewline` | `true`                    | Garantir uma quebra de linha final.                                        |
| `revo_pawn.language.includePaths`     | `[]`                      | Includes compartilhados por navegação, IntelliSense e compilação.          |
| `revo_pawn.language.maxFileSizeKB`    | `2048`                    | Limite de tamanho por arquivo para parsing e formatação.                   |
| `revo_pawn.language.maxIncludeFiles`  | `256`                     | Limite de arquivos por árvore de includes.                                 |
| `revo_pawn.language.webApiLinks`      | `false`                   | Links para a documentação oficial de includes padrão não encontrados.      |
| `revo_pawn.compiler.path`             | vazio                     | Caminho do `amxxpc`. Vazio procura o nome exato ao lado do `.sma`.         |
| `revo_pawn.compiler.arguments`        | `[]`                      | Argumentos separados; exemplo: `["-d2"]`.                                  |
| `revo_pawn.compiler.outputDirectory`  | `${fileDirname}/compiled` | Destino dos plugins compilados.                                            |
| `revo_pawn.compiler.compileOnSave`    | `false`                   | Compilar `.sma` ao salvar, em workspace confiável.                         |
| `revo_pawn.compiler.timeoutSeconds`   | `60`                      | Tempo máximo por compilação.                                               |
| `revo_pawn.compiler.showOutput`       | `true`                    | Abrir o painel de saída na compilação manual.                              |

A pasta `include` ao lado do arquivo e a pasta `include` ao lado do compilador configurado também entram na busca. Para uma árvore com `classes`, `addon` e `core`, configure `${workspaceFolder}/include` explicitamente. Não há SDK ou compilador embutido, download automático ou telemetria.

## Recursos de edição

- Syntax highlighting TextMate, comentários, pares de caracteres e snippets.
- Autocomplete de funções, natives, macros, constantes, variáveis, parâmetros e includes.
- Hover com assinatura e documentação, ajuda de parâmetros, Go to Definition e links de includes.
- Outline de funções e declarações globais; folding de blocos, comentários, regiões e condicionais.
- Includes transitivos com detecção de ciclos, cache limitado e leitura de includes abertos ainda não salvos.

As sugestões são obtidas dos seus arquivos e includes. Configure as versões de AMXX, ReAPI e bibliotecas usadas pelo projeto para receber as assinaturas correspondentes.

## Formatação Pawn

```pawn
// Antes
public plugin_init(){new x=1;if(x){server_print("ok");}}

// Depois
public plugin_init()
{
    new x = 1;
    if (x)
    {
        server_print("ok");
    }
}
```

O formatador usa análise léxica e planejamento estrutural. Ele organiza espaçamento, indentação, blocos, `if/else`, loops, `switch/case`, arrays, enums, tags e argumentos nomeados. Mantém o padrão de fim de linha (LF/CRLF) e o BOM. Não adiciona/remove ponto e vírgula nem chaves de controle. As quebras existentes entre instruções são preservadas, inclusive em código sem `;`.

Strings com escapes Pawn (`^`), caracteres, strings packed/raw, comentários, diretivas e continuações são preservados. Um `#pragma ctrlchar` literal incondicional é reconhecido. A saída passa por uma segunda análise para verificar que todos os tokens permaneceram iguais. Erros léxicos, delimitadores desbalanceados, mudança condicional de escape, uso explícito de `__LINE__` e limites de complexidade fazem o formatador manter o arquivo intacto; o motivo aparece em **Output → Revo Pawn**.

Para manter uma tabela ou região exatamente como está:

```pawn
// revo-format off
new table[][] = { { 1,  2 }, { 10, 20 } };
// revo-format on
```

**Format Selection** usa a estrutura do documento completo, mas devolve edições apenas para as linhas selecionadas. Se a seleção cortar uma string ou comentário multilinha, nenhuma edição é aplicada.

O núcleo não é um compilador nem um pré-processador completo. Não expande macros/includes para provar equivalência semântica, não escolhe ramos de `#if` e não transforma código AMXX em SourcePawn. Macros que dependem de whitespace ou alteram a sintaxe podem exigir regiões `revo-format off`. A igualdade de tokens é uma proteção adicional, não uma prova universal de equivalência. Os testes de compilação complementam essa verificação para o corpus coberto.

## Compilar

Na paleta de comandos:

- **Revo Pawn: Compile Plugin** usa o compilador configurado.
- **Revo Pawn: Compile with Local amxxpc** usa `amxxpc.exe`/`amxxpc` ao lado do `.sma`.
- **Revo Pawn: Cancel Compilation** cancela a compilação atual.
- **Revo Pawn: Show Output** mostra o log.

A extensão salva o arquivo e os includes abertos utilizados por ele antes de compilar. Os argumentos são passados diretamente ao processo, com `shell: false`. O processo tem cancelamento, timeout e limite de saída. Erros e avisos de stdout/stderr aparecem no painel **Problems**. Uma nova compilação cancela a anterior.

O compilador grava em um arquivo temporário na pasta de saída. O `.amxx` anterior só é substituído após sucesso; falhas e resultados de fontes editadas durante a compilação são descartados. Compilar exige **Workspace Trust**. Edição e formatação funcionam em **Restricted Mode**.

## Desenvolvimento e testes

Requer Node.js **22 ou superior** para as ferramentas de desenvolvimento.

```powershell
npm ci
npm run validate
npm run package
```

Use **F5 → Run Revo Pawn** para abrir um Extension Development Host. `npm run watch` recompila alterações. `npm run format` padroniza o código TypeScript/JSON/Markdown deste repositório.

```powershell
# Testes reais de extensão; pode baixar o VS Code estável se nenhum caminho for informado.
npm run test:integration -- "C:/caminho/para/Code.exe"

# SDK oficial de teste, somente dentro de .tools (Windows).
node scripts/download-sdk.mjs
Expand-Archive .tools/amxmodx-1.10.0-git5481-base-windows.zip .tools/amxx-sdk -Force
npm run test:compiler

# Medição pelo worker empacotado, incluindo troca de mensagens.
npm run benchmark
```

`AMXX_SDK` pode apontar para outro SDK de teste. O teste de compilador usa somente os plugins oficiais encontrados nessa pasta e cria as variantes em `.tools/compiler-tests`.

O teste de corpus externo só lê as origens. Cópias e relatórios precisam ficar em `.tools` e são excluídos do Git e do VSIX:

```powershell
node scripts/test-corpus.mjs --out .tools/meu-corpus "D:/projeto/classes" "D:/projeto/addon" "D:/projeto/core"
```

O relatório contém contagens, SHA-256 dos originais, igualdade de tokens, assinaturas e idempotência. Essa ferramenta não compila nem altera os plugins externos. Veja `docs/VALIDATION.md` para a validação realizada nesta entrega.

CLI de formatação para CI (somente arquivos UTF-8):

```powershell
node dist/cli.js --check examples/plugin.sma
node dist/cli.js --write caminho/plugin.sma
```

`--check` sai com código 1 se houver mudanças; código 2 indica falha ou formatação recusada. `--write` altera os arquivos informados. Na extensão, a codificação e a gravação são gerenciadas pelo VS Code.

## Distribuição

`npm run package` gera o VSIX em `artifacts/`. O pacote contém os bundles, gramática, snippets, licença e o código-fonte correspondente; não contém dependências de desenvolvimento, SDK, perfis de teste ou corpus privado. As bibliotecas de runtime utilizadas são apenas as nativas do Node e a API do VS Code.

O identificador local é `revo.revo-pawn`. Antes de publicar no Marketplace, configure o publisher que você controla e o endereço real do repositório. Este projeto não foi publicado nem instalado no seu perfil principal automaticamente.
