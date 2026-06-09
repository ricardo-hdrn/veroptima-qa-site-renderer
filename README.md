# veroptima-qa-site-renderer

HTML site renderer for [qa-expert](https://github.com/ricardo-hdrn) plugins. Implements `@qa-expert/renderer-adapter-contract` **v0.1.0**.

The plugin consumes a `SiteInputs` (FeatureSet + evidence + runflow bundle, already loaded from disk by the host) and emits `SiteOutput` (HTML bytes + the files-to-copy plan). Stateless and deterministic — same inputs produce byte-identical bytes; the host owns the output directory and file copying.

## Install (per ADR-0027)

Drop a renderer entry into your `qa-engineer.json`:

```jsonc
{
  "plugins": {
    "renderers": [
      {
        "id": "site",
        "ref": "file:/abs/path/to/veroptima-qa-site-renderer"
      }
    ]
  }
}
```

Or, when distributed via the published manifest:

```jsonc
{
  "plugins": {
    "renderers": [
      {
        "id": "site",
        "ref": "github:ricardo-hdrn/veroptima-qa-site-renderer@v0.1.0"
      }
    ]
  }
}
```

## Use

```sh
qa-expert site build \
  --capability <feature-id> \
  --session-dir <abs-path-to-session> \
  --out <output-dir> \
  --now <iso-timestamp>
```

The CLI resolves the renderer through the unified plugin loader, calls `adapter.renderSite(inputs)`, and writes `index.html` + `MANIFEST.json` + every file listed in `output.filesToCopy` (brand kit, fonts, evidence dirs, runflow bundle) into `--out`.

## What it renders

- **Hero** with brand wordmark, feature name, KPI chips (counts of planos / decisões / findings / evidências)
- **KPI stats row** — Completude / Conformidade %  (decision-as-unit) + bug + bloqueados + cenários
- **Tab nav** (6 tabs): Visão geral / Cobertura detalhada / Casos de teste / Especificação / Critérios (ACs) / Método
- **§Painel** — Compl/Conf gauges + status-distribution bar + 5-dimension heatmap (Decisão / Objetivo / Plano / Cenário / AC) with color-mix intensity
- **§01 O que faz / Não faz** — listcards with status dots
- **§02 Especificação** — 6 KPI tiles (endpoints / entidades / migrações / forms / conditionals / enum states) + Endpoints REST table + Entidade cards (column chips + enum chips) + Migrações table
- **§03 Critérios** — ACs grouped by theme (from `cite.ac_id` prefix), each in its own card
- **§04 Casos** — scenario `<details>` collapsibles per plan with filter buttons; per-scenario evidence carousel + video link when files exist
- **§05 Mapa de cobertura** — decision table with filter buttons; same code-cite join as the heatmap (consistent totals)
- **§06 + §07 Findings** — `.cx-h` header pattern; spec_drift split into Doc × Código / Doc × Doc; predicted-vs-observed pairs surfaced from `finding.contradiction.source_a/b`
- **§08 Método** — checkpoint timeline (renders only fields persisted in the JSON; no invented prose)

## Design contract

- **100% data-driven**: every number, name, status, citation, count, path, line range comes from the FeatureSet. Section labels are generic UI; placeholders for missing data are honest ("(synths.tables vazio)" etc.).
- **Self-contained offline**: CSS + brand SVGs + self-hosted Audiowide font (woff2) bundled inside the plugin — no Google Fonts CDN, no external CSS.
- **Deterministic**: no `Date.now()` / `Math.random()` in the render path; `inputs.builtAtIso` is the only time source.
- **Brand vocabulary ported, not copied**: section markup uses the gold-reference component classes (`.topbar`, `.hero`, `.chips`, `.stat`, `.card`, `.gauge`, `.heat`, `.fbtn`, `.sc`, `.pill`, `.cx-h`, `.tl`, ...). Same visual language, the renderer's DOM.

## Config

```ts
{
  locale: "pt-BR"   // default; only pt-BR supported in v1
}
```

## Acceptance

- Builds an offline-openable site against the SICARF-SP M1 FeatureSet (`~/.qa-sessions/dev/dev/td-m1-cadastro-certidao/`).
- Same inputs → byte-identical bytes (deterministic).
- Blocked plans surface `blocked_reason` — no fabricated pass.
- Decision-, scenario-, AC-, plan-level statuses derive from the same code-cite join (consistent across §Painel heatmap, §Cobertura table, §Casos pills, KPIs).
