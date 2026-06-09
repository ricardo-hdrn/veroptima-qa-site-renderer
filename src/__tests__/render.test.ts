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

const FIXED_TIME = "2026-06-09T12:00:00Z";

function makeInputs(): SiteInputs {
  return {
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
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
  };
}

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
  /** Pull the rendered "Por decisão" heatmap table's totrow Compl. % and
   *  the §Cobertura table's per-status counts. They must agree on the
   *  decision-status distribution — they come from the same coverage helper. */
  test("decision-status tally matches between cobertura table rows and heatmap totrow", async () => {
    const out = await renderSite(makeInputs());

    // §Cobertura Detalhada table rows: count by data-v attribute
    const covRowMatches = out.html.matchAll(/<tr data-v="([^"]+)">/g);
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

    // Heatmap total row's count per status = sum of cells in that column.
    // We pull the totrow's <td class="cell"><b>N</b></td> cells; their order
    // matches STATUS_CUTS = [ok, partial, gap, blocked, bug].
    const totrow = decisaoHtml.match(/<tr class="totrow">[\s\S]*?<\/tr>/);
    expect(totrow).not.toBeNull();
    const totalCells = [...totrow![0]!.matchAll(/<td class="cell"><b>(\d+)<\/b><\/td>/g)].map((m) =>
      parseInt(m[1]!, 10),
    );
    // Five cuts: ok, partial, gap, blocked, bug.
    expect(totalCells.length).toBe(5);
    const [ok, partial, gap, blocked, bug] = totalCells;

    // Tallies match between the two surfaces.
    expect(covTally["ok"] ?? 0).toBe(ok!);
    expect(covTally["partial"] ?? 0).toBe(partial!);
    expect(covTally["gap"] ?? 0).toBe(gap!);
    expect(covTally["blocked"] ?? 0).toBe(blocked!);
    expect(covTally["bug"] ?? 0).toBe(bug!);
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
