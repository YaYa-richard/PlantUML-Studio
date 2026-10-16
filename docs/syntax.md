# Supported syntax / 语法范围

PUML Studio parses a practical subset into its own editable model. It does not invoke PlantUML. Warnings include input line numbers and remain visible under the source editor.

| Syntax | Result |
| --- | --- |
| `@startuml`, `@enduml`, blank lines, apostrophe comments | Accepted |
| `left to right direction`, `top to bottom direction` | Rank layout direction |
| `component "服务" as API`, `database DB` | Editable node, optional alias |
| `rectangle`, `component`, `database`, `actor`, `class`, `interface`, `enum`, `entity`, `object`, `state`, `usecase`, `queue`, `artifact`, `circle` | Supported declarations; some kinds use a generic rectangle |
| `participant Client` | Ordinary node, warning about lost sequence semantics |
| `[Component]`, `[Component] as C` | Component node |
| `class User {` followed by members and a closing `}` | Header plus editable plain-text member area |
| `User : + login()` | Append member text to an already declared node |
| `A --> B : message`, `A <-- B`, `A -- B`, `A ..> B` | Editable relationship |
| `A <|.. B`, `A *-- B`, directional/color arrow hints | Relationship retained, specialized ends/hints simplified with warning |
| `rectangle "Label" as A #DDEEF3` | Hex fill color |
| `start`, `:Activity;`, `stop` / `end` | Linear activity chain |
| Container blocks: `package`, `frame`, `folder`, `cloud`, `node`, `rectangle`, `component` | Flattened with warning |
| `skinparam`, `hide`, `show`, title, legend, notes, includes/macros | Ignored with warning; no external content fetched |
| Other statements | Warning; review graph manually |

Quoted labels can contain `\n`. Bare identifiers accept Unicode letters/numbers, `_`, `.`, `$`. Class bodies and activity statements currently need one statement per line; inline class blocks, multiline activity descriptions, stereotypes and arbitrary PlantUML grammar are not implemented.

A warning is not a guarantee of semantic preservation: sequence-style arrows can look identical to structural links. The app is intended for component/class relationships and simple activity chains. Nested activity control flow and sequence timelines need dedicated parsers and editors.

## Editing and persistence

The project schema is `{ version: 1, source, direction, nodes, edges }`. Each node has an independent ID, label, body, shape, colors and geometry. Each edge refers to node IDs and has a label, line style, arrow flags and optional `waypoints` (an ordered array of canvas coordinates), `sourceAnchor` / `targetAnchor` (node-relative coordinates in the range 0–1). An optional `labelBox` stores `{ dx, dy, w, h }`, with center offsets relative to the route label anchor; line breaking is calculated from actual browser font metrics. Optional `labelStyle: { fill: "#rrggbb", opacity: 0..1 }` controls background fill separately from label geometry; absent styles default to transparent. Legacy single `bend` projects are still supported; the first path edit materializes their route as multiple waypoints.

Source text and editable graph are separate. Generating rebuilds the graph; manually editing the graph never rewrites source. JSON project import validates node geometry, IDs and edge references. Paths over 500 waypoints, projects over 2,000 nodes / 5,000 edges or input files over 5 MB are rejected.

The SVG export includes independent SVG shapes/text and a white background without grid or selection handles. PNG rasterizes the same SVG at 2× resolution; very large raster dimensions are rejected in favor of SVG. Font rendering depends on fonts installed on the device. draw.io XML includes native `mxCell` vertices and edges, with class member text and line-label boxes as child cells. Shapes/fonts/routing can vary between draw.io versions; the resulting objects remain editable.
