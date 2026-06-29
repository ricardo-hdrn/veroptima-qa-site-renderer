/**
 * Plugin self-tests. Four load-bearing properties:
 *
 *   1. Determinism — same inputs (including builtAtIso) → byte-identical HTML.
 *      The renderer must never reach for Date.now() / Math.random(). The
 *      determinism test is the cheapest line of defense against that.
 *
 *   2. Section presence — all 9 §-sections render even when input arrays are
 *      empty. Honest "(sem dados)" placeholders are fine; a missing <h2> is
 *      a regression.
 *
 *   3. §Cobertura table ↔ §Painel heatmap consistency — both surfaces derive
 *      decision status from the shared coverage helper. If anyone re-implements
 *      the join, the totals diverge and this assertion catches it.
 *
 *   4. No invented prose — guards against scenario-specific narrative creeping
 *      back. Greps the HTML for known flag-phrases and a few that the user
 *      explicitly called out during development.
 */
import { describe, expect, test } from "bun:test";

import type { SiteInputs } from "@qa-expert/renderer-adapter-contract";

import { renderSite } from "../render.js";
import type {
  AdjudicatedFlowStatus,
  AdjudicatedSiteInputs,
  SiteAdjudicatedKpis,
} from "../types.js";

const FIXED_TIME = "2026-06-09T12:00:00Z";

function makeInputs(adjudicated?: SiteAdjudicatedKpis): AdjudicatedSiteInputs {
  const base: AdjudicatedSiteInputs = {
    source: {
      sessionDir: "/tmp/fake-session",
      capabilityId: "feat-1",
      featureDir: "/tmp/fake-session/features/feat-1",
    },
    feature: {
      id: "feat-1",
      name: "Feature One",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
    specs: [
      {
        id: "SPEC-AC-FOO",
        kind: "ac",
        title: "AC one",
        cite: { kind: "doc", ac_id: "AC-FOO", verbatim_quote: "quote A" },
      },
      {
        id: "SPEC-AC-BAR",
        kind: "ac",
        title: "AC two",
        cite: { kind: "doc", ac_id: "AC-BAR" },
      },
    ],
    storiesAcs: [],
    synths: {
      endpoints: [
        {
          method: "POST",
          path: "/api/x",
          controller_ref: { file: "src/X.java", line_range: "10-20" },
          auth_notes: "@CurrentUser",
        },
      ],
      entities: [
        {
          name: "Entity1",
          class_ref: { file: "src/Entity1.java", line_range: "1-50" },
          table: { schema: "public", name: "entity_1" },
          columns: [{ column_name: "id", java_field: "id", nullable: false }],
          enum_constants: [
            { type_name: "Status", constants: [{ name: "OPEN" }, { name: "CLOSED" }] },
          ],
        },
      ],
      tables: [
        {
          schema: "public",
          name: "entity_1",
          migration_ref: { file: "db/V001.sql", line_range: "1-10" },
          columns: [{ name: "id", type: "SERIAL", nullable: false }],
          primary_key: ["id"],
        },
      ],
      form_components: [{}, {}, {}],
      form_conditionals: [{}, {}],
    },
    decisions: [
      {
        id: "D-A",
        section: "alpha",
        cites: [
          { kind: "code", file: "src/X.java", line_start: 10, line_end: 20 },
          { kind: "doc", ac_id: "AC-FOO" },
        ],
      },
      {
        id: "D-B",
        section: "beta",
        cites: [{ kind: "doc", ac_id: "AC-BAR" }],
      },
    ],
    scenarios: [
      {
        id: "SC-OK",
        name: "Scenario OK",
        intent: "exercises D-A",
        cites: [{ kind: "code", file: "src/X.java", line_start: 12, line_end: 18 }],
      },
    ],
    plans: [
      {
        id: "PLAN-OK",
        name: "Ticked plan",
        status: "ticked",
        target_test_flow_ids: ["SC-OK"],
      },
      {
        id: "PLAN-BLOCK",
        name: "Blocked plan",
        status: "blocked",
        blocked_reason: "source-gap: fixture missing",
      },
    ],
    findings: [
      { id: "BUG-1", kind: "bug", title: "bug one", summary: "" },
      { id: "POQ-1", kind: "po_question", title: "q one", summary: "" },
    ],
    checkpoints: {
      A: { stage: "ground", closed_at: "2026-01-01T00:00:00Z" },
      B: null,
      C: null,
    },
    evidenceDirs: [],
    runflowDir: null,
    flowsWithVerdicts: [],
    unattachedVerdicts: [],
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
  };
  if (adjudicated) base.adjudicated = adjudicated;
  return base;
}

const GROUNDED: SiteAdjudicatedKpis = {
  noAdjudicatedData: false,
  completude: { verified: 8, addressable: 10, pct: 80 },
  conformidade: { approved: 7, addressable: 10, pct: 70 },
  bugsApp: { count: 0, flows: [] },
  verdictIntegrity: { count: 1, flows: ["FLOW-FLIP"] },
};

describe("renderSite — determinism", () => {
  test("two renders against the same inputs produce byte-identical bytes", async () => {
    const a = await renderSite(makeInputs());
    const b = await renderSite(makeInputs());
    expect(a.html).toBe(b.html);
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });
});

describe("renderSite — all 9 sections present", () => {
  test("every § heading renders even with sparse data", async () => {
    const out = await renderSite(makeInputs());
    const sections = [
      "Completude e Cobertura",
      "O que faz",
      "Especificação",
      "Objetivos",
      "Casos de teste",
      "Mapa de cobertura de decisões",
      "Bugs",
      "Contradições encontradas",
      "Questões que só o PM/PO pode responder",
      "Método",
    ];
    for (const s of sections) expect(out.html).toContain(s);
  });
});

describe("renderSite — coverage consistency (§Cobertura table ↔ §Painel heatmap)", () => {
  /** Both the §Cobertura decision table and the §Painel "Por decisão" heatmap
   *  derive decision status from the SAME GROUNDED coverage helper. Each surface
   *  single-sources its visible status from a `data-v` attribute; the per-status
   *  tallies must reconcile row-for-row. (Grounded reconciliation: both read the
   *  per-goal verdict map, never two different joins.) */
  test("decision-status tally matches between cobertura table rows and heatmap totrow", async () => {
    const out = await renderSite(makeInputs());

    // §Cobertura Detalhada table rows: count by data-v attribute. Scope to the
    // §cobertura section so we don't also pick up the heatmap's own data-v rows.
    const covSection = out.html.match(
      /<section id="cobertura"[\s\S]*?<\/section>/,
    );
    expect(covSection).not.toBeNull();
    const covRowMatches = covSection![0]!.matchAll(/<tr data-v="([^"]+)">/g);
    const covTally: Record<string, number> = {};
    for (const m of covRowMatches) covTally[m[1]!] = (covTally[m[1]!] || 0) + 1;

    // §Painel heatmap "Por decisão" JSON island
    const island = out.html.match(
      /<script type="application\/json" id="dash-heat-data">([\s\S]*?)<\/script>/,
    );
    expect(island).not.toBeNull();
    const data = JSON.parse(island![1]!.replace(/\\u003c/g, "<")) as Record<string, string>;
    const decisaoHtml = data["decisao"]!;
    expect(decisaoHtml).toBeDefined();

    // Heatmap "Por decisão" per-row data-v tally (the body status, single-sourced).
    const heatTally: Record<string, number> = {};
    for (const m of decisaoHtml.matchAll(/<tr data-v="([^"]+)">/g))
      heatTally[m[1]!] = (heatTally[m[1]!] || 0) + 1;

    // Same number of decisions, and the per-status distribution reconciles.
    expect(Object.values(covTally).reduce((a, b) => a + b, 0)).toBe(
      Object.values(heatTally).reduce((a, b) => a + b, 0),
    );
    for (const k of new Set([...Object.keys(covTally), ...Object.keys(heatTally)])) {
      expect(covTally[k] ?? 0).toBe(heatTally[k] ?? 0);
    }
  });
});

describe("renderSite — no invented prose", () => {
  test("known scenario-specific or interpretive phrases must NOT appear", async () => {
    const out = await renderSite(makeInputs());
    const forbidden = [
      "Stage 1 — Ground",
      "Stage 2 — Plan",
      "Stage 3 — Verify",
      "Fundamentação (ingest",
      "Planejamento (synth",
      "Verificação (post-run",
      "UI + API",
      "Detalhamento de QE/QA",
      "engagement entrega",
      "Migrações decisivas para a emissão",
      "spec vs. implementação",
      "spec vs. spec",
      "divergência ativa",
      "cenários autorizados",
    ];
    for (const phrase of forbidden) {
      expect(out.html.includes(phrase)).toBe(false);
    }
  });
});

describe("renderSite — blocked plan integrity", () => {
  test("blocked_reason surfaces in §Casos; no fabricated pass", async () => {
    const out = await renderSite(makeInputs());
    expect(out.html).toContain("PLAN-BLOCK");
    expect(out.html).toContain("source-gap: fixture missing");
  });
});

describe("renderSite — grounded adjudicated result is the headline", () => {
  test("adjudicated present → 80/70 shown as the RESULT; data-attrs carry 80/70/0", async () => {
    const out = await renderSite(makeInputs(GROUNDED));

    // Machine-extractable grounded truth (for the downstream cross-surface gate).
    expect(out.html).toContain('data-grounded-completude="80"');
    expect(out.html).toContain('data-grounded-conformidade="70"');
    expect(out.html).toContain('data-grounded-bugsapp="0"');
    expect(out.html).toContain('data-no-adjudicated="false"');

    // The headline gauges are painted from the adjudicated pct (these ids exist
    // ONLY on the grounded result-card — the synth gauges were demoted/removed).
    expect(out.html).toContain('id="g-compl" data-pct="80"');
    expect(out.html).toContain('id="g-conf" data-pct="70"');
    // Human-visible result numbers + denominators.
    expect(out.html).toContain("80%");
    expect(out.html).toContain("70%");
    expect(out.html).toContain("8/10");
    expect(out.html).toContain("7/10");
    // verdictIntegrity surfaced as an integrity note, NOT a bug.
    expect(out.html).toContain("não é bug");

    // Subordinate synthesis section present AND clearly labeled subordinate.
    expect(out.html).toContain("Síntese (intenção de design) — não é o resultado medido");
    // The synth heatmap island still renders (subordinate, not the headline).
    expect(out.html).toContain('id="dash-heat-data"');
  });

  test("noAdjudicatedData:true → honest gap; never 0%/100% as a result", async () => {
    const gap: SiteAdjudicatedKpis = {
      noAdjudicatedData: true,
      completude: { verified: 0, addressable: 0, pct: 0 },
      conformidade: { approved: 0, addressable: 0, pct: 0 },
      bugsApp: { count: 0, flows: [] },
      verdictIntegrity: { count: 0, flows: [] },
    };
    const out = await renderSite(makeInputs(gap));

    expect(out.html).toContain('data-no-adjudicated="true"');
    // Honest gap copy present.
    expect(out.html).toContain("Sem veredito adjudicado");
    // The 0/100 synth stand-in must NOT be emitted as the grounded result.
    expect(out.html).not.toContain('data-grounded-completude="0"');
    expect(out.html).not.toContain('data-grounded-conformidade="100"');
    // No headline result gauges painted in the gap case.
    expect(out.html).not.toContain('id="g-compl"');
  });

  test("raw findings (kind=bug) are labeled raw — distinct from adjudicated bugsApp", async () => {
    const out = await renderSite(makeInputs(GROUNDED));
    // The §06 raw-findings label exists and is explicitly distinguished.
    expect(out.html).toContain("achados brutos (raw findings)");
    expect(out.html).toContain('data-raw-findings="bug"');
    // The adjudicated bugsApp result lives on the grounded card, separate.
    expect(out.html).toContain('data-grounded-bugsapp="0"');
  });
});

// ── GROUNDED BODY (per-item status from the per-goal verdict map) ────────────
//
// A busca-shaped fixture: a satisfied flow, a violated flow, a not_adjudicated
// flow, plus two UNMAPPABLE scenarios (one with no flow_id, one whose flow_id
// is absent from the verdict map). The BODY must render each item's REAL status
// joined item → flow → flowStatus, with Sem mapeamento as a distinct loud gap.

const BUSCA_FLOW_STATUS: Record<string, AdjudicatedFlowStatus> = {
  "FLOW-SAT": "satisfied",
  "FLOW-VIO": "violated",
  "FLOW-NADJ": "not_adjudicated",
};

const BUSCA_ADJ: SiteAdjudicatedKpis = {
  noAdjudicatedData: false,
  completude: { verified: 1, addressable: 3, pct: 33 },
  conformidade: { approved: 1, addressable: 3, pct: 33 },
  bugsApp: { count: 1, flows: ["FLOW-VIO"] },
  verdictIntegrity: { count: 0, flows: [] },
  flowStatus: BUSCA_FLOW_STATUS,
};

function makeBuscaInputs(): AdjudicatedSiteInputs {
  return {
    source: {
      sessionDir: "/tmp/busca-session",
      capabilityId: "busca",
      featureDir: "/tmp/busca-session/features/busca",
    },
    feature: {
      id: "busca",
      name: "Busca",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
    specs: [],
    storiesAcs: [],
    synths: { endpoints: [], entities: [], tables: [], form_components: [], form_conditionals: [] },
    decisions: [
      // Linked to a satisfied-flow scenario via evidence_scenario_ids → ok.
      { id: "D-SAT", section: "busca", evidence_scenario_ids: ["SC-SAT"], cites: [] },
      // No resolvable flow → SEM MAPEAMENTO (loud gap).
      { id: "D-NONE", section: "outros", cites: [{ kind: "doc", ac_id: "AC-X" }] },
    ],
    scenarios: [
      { id: "SC-SAT", name: "Busca satisfeita", flow_id: "FLOW-SAT", cites: [] },
      { id: "SC-VIO", name: "Busca violada", flow_id: "FLOW-VIO", cites: [] },
      { id: "SC-NADJ", name: "Busca não adjudicada", flow_id: "FLOW-NADJ", cites: [] },
      // UNMAPPABLE: no flow_id at all.
      { id: "SC-ORPHAN", name: "Cenário sem fluxo", cites: [] },
      // UNMAPPABLE: flow_id absent from the verdict map.
      { id: "SC-GHOST", name: "Cenário fluxo fantasma", flow_id: "FLOW-GHOST", cites: [] },
    ],
    plans: [
      {
        id: "PLAN-SAT",
        name: "Plano busca",
        status: "ticked",
        target_test_flow_ids: ["SC-SAT", "SC-VIO", "SC-NADJ", "SC-ORPHAN", "SC-GHOST"],
        flow_ids: ["FLOW-SAT"],
      },
    ],
    findings: [],
    checkpoints: { A: null, B: null, C: null },
    evidenceDirs: [],
    runflowDir: null,
    flowsWithVerdicts: [],
    unattachedVerdicts: [],
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
    adjudicated: BUSCA_ADJ,
  };
}

/** Pull the `data-v` of the case pill (details.sc) for a given scenario id. */
function casePillStatus(html: string, scenarioId: string): string | null {
  const re = new RegExp(
    `<details class="sc" data-v="([^"]+)">\\s*<summary>\\s*<span class="scid">${scenarioId}</span>`,
  );
  const m = html.match(re);
  return m ? m[1]! : null;
}

describe("renderSite — grounded BODY (per-item status from flowStatus)", () => {
  test("case pills render the REAL per-goal status; Sem mapeamento is distinct", async () => {
    const out = await renderSite(makeBuscaInputs());

    // satisfied → Coberto (ok); violated → Falhou (failed); not_adjudicated → gap.
    expect(casePillStatus(out.html, "SC-SAT")).toBe("ok");
    expect(casePillStatus(out.html, "SC-VIO")).toBe("failed");
    expect(casePillStatus(out.html, "SC-NADJ")).toBe("gap");

    // UNMAPPABLE items render the loud gap, NEVER "Não executado" (gap).
    expect(casePillStatus(out.html, "SC-ORPHAN")).toBe("unmapped");
    expect(casePillStatus(out.html, "SC-GHOST")).toBe("unmapped");

    // The loud-gap label is visibly present and distinct from Não executado.
    expect(out.html).toContain("Sem mapeamento");
    expect(out.html).toContain("Falhou");
    expect(out.html).toContain("Coberto");
  });

  test("grounded distribution bar reconciles to the per-goal verdict map", async () => {
    const out = await renderSite(makeBuscaInputs());

    // The grounded distribution legend carries data-v per cut, single-sourced
    // count. Tally the flowStatus map directly and compare.
    const expected: Record<string, number> = {};
    for (const s of Object.values(BUSCA_FLOW_STATUS)) {
      const cut = s === "satisfied" ? "ok" : s === "violated" ? "failed" : "gap";
      expected[cut] = (expected[cut] ?? 0) + 1;
    }
    for (const [cut, n] of Object.entries(expected)) {
      // <span data-v="ok"><i ...></i><b>1</b> Coberto</span>
      const re = new RegExp(`<span data-v="${cut}"><i[^>]*></i><b>(\\d+)</b>`);
      const m = out.html.match(re);
      expect(m).not.toBeNull();
      expect(parseInt(m![1]!, 10)).toBe(n);
    }
  });

  test("the synth design-intent block is present and labeled subordinate", async () => {
    const out = await renderSite(makeBuscaInputs());
    expect(out.html).toContain("Síntese (intenção de design) — não é o resultado medido");
    // The grounded execution body is the primary surface above it.
    expect(out.html).toContain('data-grounded-body="1"');
    expect(out.html).toContain("Cobertura de execução");
  });

  test("TRANSITIVE decision join: linked-to-satisfied → Coberto; no flow → Sem mapeamento", async () => {
    const out = await renderSite(makeBuscaInputs());
    // §Cobertura decision rows carry data-v from the grounded transitive join.
    expect(out.html).toMatch(/<tr data-v="ok">\s*<td class="mono">D-SAT<\/td>/);
    expect(out.html).toMatch(/<tr data-v="unmapped">\s*<td class="mono">D-NONE<\/td>/);
  });

  test("MUTATION GUARD: an unmappable item is NOT bucketed as Não executado (gap)", async () => {
    const out = await renderSite(makeBuscaInputs());
    // If a section silently mapped unmappable → gap, SC-ORPHAN would read "gap".
    // The honesty guard requires it to be the distinct "unmapped" state.
    expect(casePillStatus(out.html, "SC-ORPHAN")).not.toBe("gap");
    expect(casePillStatus(out.html, "SC-ORPHAN")).toBe("unmapped");
  });
});

describe("renderSite — grounded pcts are rounded ONCE (Math.round) for display", () => {
  // A fractional ratio that exposes the floor-vs-round bug: completude 3/8 = 37.5
  // (floor 37, round 38 — the monitor shows 38) and conformidade 2/3 = 66.666…
  // (floor 66, round 67 — the monitor shows 67).
  const FRACTIONAL: SiteAdjudicatedKpis = {
    noAdjudicatedData: false,
    completude: { verified: 3, addressable: 8, pct: 37.5 },
    conformidade: { approved: 2, addressable: 3, pct: 66.66666666666667 },
    bugsApp: { count: 0, flows: [] },
    verdictIntegrity: { count: 0, flows: [] },
  };

  test("visible text == data-attribute == gauge, all Math.round'd, no raw float", async () => {
    const out = await renderSite(makeInputs(FRACTIONAL));

    // Math.round, matching the monitor: 37.5 → 38, 66.66… → 67.
    // Visible result text.
    expect(out.html).toContain("<b>38%</b>");
    expect(out.html).toContain("<b>67%</b>");
    // Data-attributes carry the SAME rounded int.
    expect(out.html).toContain('data-grounded-completude="38"');
    expect(out.html).toContain('data-grounded-conformidade="67"');
    // Gauges painted from the SAME rounded int.
    expect(out.html).toContain('id="g-compl" data-pct="38"');
    expect(out.html).toContain('id="g-conf" data-pct="67"');
    // Hero KPI cards (stats) show the rounded value too.
    expect(out.html).toContain('<div class="v">38%</div>');
    expect(out.html).toContain('<div class="v">67%</div>');

    // visible == attribute: the floored variants must NOT appear anywhere.
    expect(out.html).not.toContain("37%");
    expect(out.html).not.toContain("66%");
    expect(out.html).not.toContain('data-grounded-completude="37"');
    expect(out.html).not.toContain('data-grounded-conformidade="66"');

    // NO raw float rendered for the grounded pcts.
    expect(out.html).not.toContain("37.5");
    expect(out.html).not.toContain("66.66");
    expect(out.html).not.toContain("66.667");
    // No 15-digit float anywhere in the document.
    expect(/\d+\.\d{3,}/.test(out.html)).toBe(false);
  });
});
