# Diagrams

Each diagram is a small HTML page: cards laid out with CSS, and connectors routed at runtime between the rendered cards by `diagram.js`. `npm run diagrams` screenshots every page at 2× with a headless Chrome or Edge that is already installed, and writes the PNGs to `docs/assets/`.

| Source | Output | Shows |
| --- | --- | --- |
| [architecture-overview.html](architecture-overview.html) | [architecture-overview.png](../assets/architecture-overview.png) | Components, routes, core modules, services, V1 queue |
| [ingest-pipeline.html](ingest-pipeline.html) | [ingest-pipeline.png](../assets/ingest-pipeline.png) | The 8 steps from upload to searchable chunks |
| [ask-sequence.html](ask-sequence.html) | [ask-sequence.png](../assets/ask-sequence.png) | Sequence of one question, with guardrails |
| [data-model.html](data-model.html) | [data-model.png](../assets/data-model.png) | Collections, fields, keys, vector index |
| [deployment.html](deployment.html) | [deployment.png](../assets/deployment.png) | CI pipeline, Vercel, free-tier services |
| [roadmap.html](roadmap.html) | [roadmap.png](../assets/roadmap.png) | Six phases, four gates |
| [ai-workflow.html](ai-workflow.html) | [ai-workflow.png](../assets/ai-workflow.png) | The AI-first build loop |

## Editing

1. Open the `.html` file in a browser to preview it live.
2. Move a card by changing its `left` / `top`; connectors follow automatically.
3. Add a connector with `edge("#from", "#to", { color, label, from: "r", to: "l" })`. Options: `fromAt` / `toAt` (0–1 along the side), `points` (manual waypoints), `dash`, `both`, `step`, `labelPos`.
4. Run `npm run diagrams` (or `npm run diagrams -- data-model` for one) and commit the source and the PNG together.

Set `CHROME_PATH` if the script cannot find a browser, and `DIAGRAM_SCALE=1` for smaller files.
