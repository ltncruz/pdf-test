# Simply PDF — Arquitetura

Estado: fundação **v0.1–v0.5 estabilizada** (viewer, modelo, páginas, operações, undo/redo, exportação). Este documento descreve o que existe hoje; o que ainda não existe está marcado como *(planejado)*.

## 1. Caminho primário (obrigatório)

```
Viewer → modelo do documento → páginas → alterações (operações) → undo/redo → exportação
```

Toda funcionalidade futura entra por esse caminho. O critério de conclusão do núcleo é um teste automatizado: abrir → visualizar → modificar → desfazer → refazer → exportar → reabrir o PDF exportado → verificar a alteração (`tests/integration/roundtrip.test.ts` e `tests/e2e/slice.e2e.test.ts`).

## 2. Camadas e fronteiras

```
app/        composição (wiring), tela principal          -> livre
features/   componentes de UI (viewer)                   -> só core + porta pdf/renderer-port
pdf/        adaptadores: PDF.js (leitura/render/inspeção), pdf-lib (escrita)
services/   armazenamento (SourceStore em memória), limitador de concorrência
core/       TypeScript puro: document, pages, operations, history, export, limits, ports
```

Regras impostas por `scripts/boundaries-lib.mjs` (rodam em `npm run verify` e têm testes próprios):

- `core` só importa código dentro de `core` (nenhum pacote, nenhum `node:*`, nenhuma outra camada).
- `features` não importa `pdf-lib`/`pdfjs-dist`; de `src/pdf` só o arquivo de tipos `renderer-port`.
- `pdf` e `services` não importam React, `features` ou `app`; `services` também não importa `pdf`.

PDF.js e pdf-lib ficam **atrás de interfaces** (`SourceReader`, `PdfWriter`, `PdfInspector`, `PageRenderer`, `SourceStore`). qpdf **não** faz parte do produto ainda; é usado só como validador nos testes.

## 3. Política de licenças

O produto pode ser comercial/proprietário. Portanto:

- Só entram dependências permissivas (MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, OFL para fontes). `scripts/licenses.mjs` lê a licença **do pacote realmente instalado**: `package.json`, **todos** os arquivos de licença **por inteiro** (busca por GPL/AGPL/LGPL/SSPL/Commons Clause/BSL em qualquer posição) e registra `NOTICE`. Falha o `verify` se algo sair da política. Resultado em `THIRD_PARTY_LICENSES.md` (gerado de forma determinística).
- **MuPDF e Ghostscript não são incorporados** (AGPL/comercial).
- Dependência nova = instalar → ler a licença real → registrar → só então usar.

## 4. Document Model

```ts
interface DocumentState {
  name: string;
  sources: Record<SourceId, SourceRef>;   // metadados + traços; os BYTES ficam no SourceStore
  pages: Record<PageId, Page>;
  pageOrder: PageId[];
  revision: number;                       // +1 por operação/undo/redo (invalida caches; NÃO define dirty)
}
interface SourceRef { id; name; byteLength; pageCount; traits: { acroForm; xfa; signatures } }
```

O PDF original **nunca é alterado**. `openDocument()` valida limites, lê a estrutura via `SourceReader`, só então guarda os bytes e devolve o estado inicial (validação completa antes de qualquer escrita: falha ⇒ nada guardado).

`Page`: `origin` (`source(sourceId, index)` | `blank`), `crop` (CropBox efetiva em user space, origem inferior esquerda, sem rotação), `baseRotation` (/Rotate do arquivo), `rotation` (delta do usuário), `objects` (z-order = ordem do array). Hoje o único objeto é `TextObject` (Helvetica, WinAnsi).

### Contrato de coordenadas

Objetos vivem no **espaço de página do modelo**: pontos PDF, origem no canto **superior esquerdo** da CropBox, y para baixo, página **sem rotação**. A rotação (`baseRotation + rotation`) é só visualização/exportação: o overlay do viewer gira junto com a página e o exportador converte para user space (`modelRectToUserSpace`) antes de gravar `/Rotate`. Testado com CropBox deslocada, /Rotate herdado e página rotacionada.

## 5. Operações

Operações são **dados serializáveis**; cada uma calcula seu inverso no momento da aplicação:

| Operação | Inverso |
|---|---|
| `page/delete { pageIds }` | `page/insert` com as próprias páginas e índices originais |
| `page/insert { items: [{page, index}] }` | `page/delete` |
| `page/rotate { pageIds, delta }` | `page/rotate` com `360 - delta` |
| `object/add { pageId, object, index? }` | `object/remove` |
| `object/remove { pageId, objectId }` | `object/add` na mesma posição de z-order |
| `object/update { pageId, objectId, patch }` | `object/update` com os valores anteriores das propriedades alteradas |
| `batch { ops }` | `batch` dos inversos em ordem reversa (atômico) |

`applyOperation` é **pura e atômica**: nunca muta o estado; se falhar lança `OperationError` e nada muda. `object/update` só aceita `rect`, `text`, `fontSize`, `color` (id e kind são imutáveis).

## 6. Histórico e "dirty"

`DocumentSession` = estado + `History` (única porta de escrita). Compatível com `useSyncExternalStore`. Limite padrão de 500 entradas.

**Modelo de estado salvo.** O histórico mantém uma **posição lógica**: `position = descartadas + |pilha de undo|`, onde `descartadas` conta as entradas que saíram do fundo da pilha por causa do limite. A sessão guarda `savedPosition` (posição lógica do último `markSaved()`; o documento inicial é a posição 0) ou `null` se esse ponto deixou de existir.

- `isDirty ⇔ savedPosition === null || savedPosition !== position`.
- undo/redo mudam a posição em ±1 (voltar ao ponto salvo deixa limpo; `revision` não interfere).
- Truncar o fundo da pilha **não** muda a posição: desfazer até a posição salva deixa o documento limpo mesmo que a entrada que o criou já tenha sido descartada. Se o ponto salvo ficou além do alcance do undo, o estado alcançável nunca coincide com ele ⇒ permanece dirty (correto).
- **Ramificação:** se uma operação nova descarta um trecho de redo que continha o ponto salvo (`savedPosition > position`), `savedPosition` vira `null` (a mesma posição numérica passaria a designar outro conteúdo). Ramificar acima do ponto salvo mantém-no alcançável.
- Não há coalescência de operações nem persistência do histórico *(planejado)*.

## 7. Exportação

```
preflight → plan (puro) → materialize (PdfWriter) → verificação → bytes
```

1. **preflight**: erros (documento vazio, origem ausente, página fora do intervalo, texto vazio/não codificável, fonte/retângulo inválidos) abortam antes de gerar arquivo. Avisos: objeto fora da página e **limitações conhecidas** (formulário e assinatura não preservados).
2. **plan**: função pura `DocumentState → ExportPlan` (inclui `lineHeight` de cada texto: writer e verificação usam o mesmo valor).
3. **materialize** (`pdflib-writer.ts`): sempre um documento **novo**; páginas de cada origem copiadas numa única chamada `copyPages` por rodada (uma página usada duas vezes entra em rodadas diferentes). Links internos são tratados explicitamente (ver §8).
4. **verificação estrutural e semântica das invariantes atualmente suportadas**, com um parser diferente do writer (PDF.js):
   - nº de páginas; rotação, tamanho e origem da CropBox de cada página;
   - **identidade do conteúdo de cada página de origem** (texto extraído da saída = texto da origem, na ordem) — pega página trocada;
   - para cada caixa de texto: presença **na página certa** (mensagem específica se estiver em outra), na ordem certa, posição da linha de base (±1 pt), tamanho da fonte (±1%), quebras de linha (entrelinha e início de linha) e ausência de texto inesperado.
   - **O que NÃO é verificado:** cor e opacidade do texto, aparência visual (raster), imagens/vetores da origem, anotações, formulários, metadados. Passar na verificação significa que essas invariantes se sustentam, **não** que o arquivo é idêntico ao esperado em tudo.
5. Bytes que não passam **nunca** são devolvidos (`ExportError`). O original permanece intacto (hash conferido em testes); nunca há atualização incremental.

Custo: a verificação lê cada PDF de origem uma vez além da saída.

## 8. Compatibilidade de PDF (comportamento explícito)

| Tipo de PDF | Abre | Edita | Exporta | Preserva | Limitação atual |
|---|---|---|---|---|---|
| MediaBox ≠ CropBox, CropBox com origem ≠ 0 | sim | sim | sim | CropBox e conteúdo | — |
| /Rotate explícito | sim | sim | sim | rotação (soma com a do usuário) | — |
| Atributos herdados da árvore (MediaBox, CropBox, Rotate, Resources) | sim | sim | sim | valores efetivos, gravados explicitamente na folha | fixture cobre herança em 1 nível |
| Anotações (nota, link URI) | sim | sim | sim | sim | só exibição no viewer: anotações não são renderizadas nem editáveis |
| Links internos | sim | sim | sim | apontam para a página exportada correspondente; **removidos** se o destino foi excluído | destinos nomeados não são copiados (inertes) |
| Formulário AcroForm | sim | sim | sim, **com aviso** | aparência (widgets) | campos deixam de ser interativos (AcroForm não é copiado) |
| Formulário XFA | sim | sim | sim, **com aviso** | páginas | formulário dinâmico não preservado |
| Assinatura digital | sim | sim | sim, **com aviso** | páginas | a assinatura **não** é preservada (novo documento) |
| Fonte TrueType incorporada | sim | sim | sim | fonte e texto original | texto novo usa Helvetica (WinAnsi) |
| Fonte padrão não incorporada | sim | sim | sim | referência da fonte | o viewer usa as fontes de `standard_fonts` |
| Imagem | sim | sim | sim | sim | sem compressão/otimização *(planejado v0.9)* |
| Multipágina (250 páginas testadas) | sim | sim | sim | ordem e identidade por página | limite de 2000 páginas |
| Lixo antes do `%PDF` / depois do `%%EOF` | sim | sim | sim | sim | — |
| xref/trailer/startxref danificados, truncado | **não** (INVALID_PDF) | — | — | — | sem reparo automático *(qpdf, planejado)* |
| Criptografado com senha | **não** (PASSWORD_REQUIRED) | — | — | — | sem suporte a senha |
| Criptografado só com restrições | **não** (ENCRYPTED) | — | — | — | a exportação não preservaria a proteção |

## 9. Guardrails de recursos (`src/core/limits.ts`)

Todos os limites vivem em um só lugar (`DEFAULT_LIMITS`, sobrescrevíveis por `resolveLimits`, validados):

| Limite | Valor | Motivo |
|---|---|---|
| `maxFileBytes` | 100 MiB | no navegador o PDF existe em ~3 cópias no pico (store, worker do PDF.js, pdf-lib) |
| `maxPages` | 2000 | custo de abertura linear por página; cobre documentos reais grandes |
| `maxPageDimensionPt` | 14 400 | limite de página do PDF 1.6+/Acrobat (200 in) |
| `maxCanvasPixels` | 16 777 216 | limite de canvas do Safari/iOS (4096×4096); ~64 MiB RGBA |
| `maxConcurrentRenders` | 3 | o PDF.js processa num worker; mais só aumenta memória |
| `minRenderScale` / `maxRenderScale` | 0,1 / 8 | fora disso a página é ilegível ou o canvas absurdo |

- Tamanho do arquivo é checado **antes** de ler para a memória (`File.size`); `maxPages` é checado pelo leitor **antes** de percorrer as páginas; dimensões inválidas/gigantes falham na abertura.
- Toda falha na abertura é `OpenError` com código e mensagem clara; nada é guardado e **a sessão atual permanece intacta**. Só depois que o novo documento abre com sucesso o anterior é substituído e seus bytes liberados.
- Renderização: fila FIFO com no máximo `maxConcurrentRenders`, cancelável (uma espera cancelada nunca inicia); escala restrita à faixa; backing store nunca acima de `maxCanvasPixels` (o tamanho na tela não muda, só a nitidez; `reducedResolution` é informado).
- **Não implementados (próximas versões):** virtualização, cache LRU, carregamento progressivo, timeout de parsing de PDF hostil.

## 10. Viewer

PDF.js (build **legacy**, com polyfills) em worker; um documento aberto por origem; renderização cancelável; rotação efetiva no viewport; miniaturas sob demanda (`IntersectionObserver`); overlay dos objetos vem do modelo. Selecionar uma caixa de texto (clique) carrega o texto no campo; **Editar texto selecionado** gera `object/update`, **Remover texto** gera `object/remove`, ambos com undo/redo. **Só é editável o texto adicionado pelo Simply PDF**; o texto original do PDF não é editável.

## 11. Estrutura de diretórios

```
src/core/{document,pages,operations,history,export}, limits.ts, ports.ts, session.ts, index.ts
src/pdf/        pdfjs-reader.ts, pdfjs-renderer.ts, renderer-port.ts, pdflib-writer.ts
src/services/   memory-source-store.ts, concurrency-limiter.ts
src/features/viewer/  PageCanvas.tsx, Thumbnail.tsx
src/app/        App.tsx, main.tsx, wiring.ts, index.html, styles.css
scripts/        build-web.mjs, check-boundaries.mjs, boundaries-lib.mjs, licenses.mjs, licenses-lib.mjs
tests/{core,integration,e2e,fixtures}   (fixtures/static: 3 PDFs binários pequenos + MANIFEST.json)
```

## 12. Testes

| Suíte | O que prova |
|---|---|
| `core/operations`, `core/session`, `core/history.random` | operações e inversos, atomicidade, imutabilidade, 300 sequências aleatórias (inclui `object/update`) |
| `core/dirty` | modelo de estado salvo: casos nomeados, truncamento, ramificação e 400 sequências contra um oráculo independente |
| `core/export`, `core/verify` | geometria, plano puro, preflight, pipeline com dublês e todos os testes negativos da verificação |
| `core/limits`, `core/limiter`, `core/renderer` | guardrails, política de abertura/atomicidade, concorrência e cancelamento (PDF.js falso) |
| `core/licenses`, `core/boundaries` | scanner de licenças (GPL/AGPL/LGPL/SSPL, NOTICE, arquivo inteiro…) e fronteiras |
| `integration/roundtrip`, `verify-sabotage` | fluxo completo com PDF.js/pdf-lib reais + `qpdf --check`; writer sabotado é rejeitado pela verificação |
| `integration/corpus` | matriz da seção 8 |
| `e2e/slice.e2e` | mesmo fluxo no Chromium real, edição de texto e guardrails |

## 13. Decisões e desvios

1. Sem "tombstones" de página (o inverso carrega as páginas). 2. `crop: Rect` em vez de `size`. 3. Dirty por **posição lógica** (§6), não por identidade de entrada nem por `revision`. 4. `node:test` + tsx + esbuild + `useSyncExternalStore` (Vite/Vitest/Zustand **não** adicionados por decisão). 5. PDF.js legacy no navegador. 6. Formulário/assinatura: exportação permitida **com aviso** em vez de bloqueio (não há corrupção; há perda de interatividade). 7. Links internos para páginas excluídas são removidos, porque o copiador do pdf-lib arrastaria a página excluída para o arquivo novo.

## 14. Pendências reais

- `package-lock.json`, `npm ci` limpo e `@types/react`/`@types/react-dom` (shim `src/types/react-shim.d.ts` ainda presente) — **bloqueados** pelo registro npm inacessível no ambiente de desenvolvimento.
- Spike PDFium, redaction, OCR, compressão, qpdf no produto, virtualização/LRU/carregamento progressivo, AcroForm preservado, senha, reparo de PDF danificado, obrigações de redistribuição no bundle (ver `THIRD_PARTY_LICENSES.md`).
