/**
 * §05b PER-FLOW results surface — EVERY adjudicated flow's status links to its
 * proving run.
 *
 * THE GAP this closes: the §Casos drill is keyed by `scenario.flow_id`, which
 * busca barely populates (2 of 8 flows), so 6/8 adjudicated flows rendered NO
 * drill. The per-flow surface iterates `adjudicated.flowStatus` keyed by
 * **flow.id**, so coverage is COMPLETE for every adjudicated flow.
 *
 * These tests pin (busca-shaped: 8 adjudicated = 7 satisfied + 1 contradictory,
 * plus a not_adjudicated and an excluded flow that must NOT drill):
 *   1. one row per flowStatus entry, each carrying its STATUS pill;
 *   2. every adjudicated flow has a drill whose data-proving-run == its verdict
 *      runId; the contradictory flow shows BOTH runs;
 *   3. a not_adjudicated / excluded flow shows status but NO drill;
 *   4. COVERAGE-COMPLETENESS: #adjudicated-drills == #adjudicated-flows
 *      (non-vacuous — proves completeness, not ≥1).
 *   + MUTATION (keep the old scenario.flow_id keying → drills < adjudicated)
 *     turns the completeness assertion RED. See the build report.
 */
import { describe, expect, test } from "bun:test";

import { renderPerFlow } from "../sections/per-flow.js";
import type {
  AdjudicatedFlowStatus,
  AdjudicatedSiteInputs,
  SiteAdjudicatedKpis,
} from "../types.js";

const FIXED_TIME = "2026-06-09T12:00:00Z";

type TryEv = { path: string; basename: string; kind: "image" | "video" | "other"; stepIndex: number | null };
type Try = { runId: string; status: "pass" | "incomplete" | "fail"; verdict: Record<string, unknown> | null; evidence: TryEv[] };

function imageEv(runId: string, idx: number, action: string): TryEv {
  const basename = `step-${idx}-${action}.png`;
  return { path: `/abs/${runId}/${basename}`, basename, kind: "image", stepIndex: idx };
}

type FlowWithVerdict = AdjudicatedSiteInputs["flowsWithVerdicts"][number];

function flowWithVerdict(flowId: string, title: string, tries: Try[], latestRunId: string): FlowWithVerdict {
  return {
    flow: { id: flowId, title },
    verdict: { runId: latestRunId, status: tries.find((t) => t.runId === latestRunId)?.status ?? null },
    evidence: {},
    tries,
    assurance: {},
    cost: { authorTokens: 0, authorWallClockMs: 0, replayCost: 0 },
  } as FlowWithVerdict;
}

// busca: 7 satisfied flows (BUSCA-1..7) + 1 contradictory (BUSCA-CPF), plus a
// not_adjudicated (BUSCA-NADJ) and an excluded (BUSCA-EXC) flow.
const SAT_IDS = ["BUSCA-1", "BUSCA-2", "BUSCA-3", "BUSCA-4", "BUSCA-5", "BUSCA-6", "BUSCA-7"];

const FLOW_STATUS: Record<string, AdjudicatedFlowStatus> = {
  ...Object.fromEntries(SAT_IDS.map((id) => [id, "satisfied" as AdjudicatedFlowStatus])),
  "BUSCA-CPF": "contradictory",
  "BUSCA-NADJ": "not_adjudicated",
  "BUSCA-EXC": "excluded",
};

const ADJ: SiteAdjudicatedKpis = {
  noAdjudicatedData: false,
  completude: { verified: 8, addressable: 9, pct: 89 },
  conformidade: { approved: 7, addressable: 9, pct: 78 },
  bugsApp: { count: 0, flows: [] },
  verdictIntegrity: { count: 1, flows: ["BUSCA-CPF"] },
  flowStatus: FLOW_STATUS,
};

function makeInputs(): AdjudicatedSiteInputs {
  const flowsWithVerdicts: FlowWithVerdict[] = SAT_IDS.map((id) =>
    flowWithVerdict(
      id,
      `Fluxo ${id}`,
      [{ runId: `run-${id}`, status: "pass", verdict: null, evidence: [imageEv(`run-${id}`, 1, "open")] }],
      `run-${id}`,
    ),
  );
  flowsWithVerdicts.push(
    flowWithVerdict(
      "BUSCA-CPF",
      "Busca por CPF inválido",
      [
        { runId: "run-cpf-pass", status: "pass", verdict: null, evidence: [imageEv("run-cpf-pass", 1, "ok")] },
        { runId: "run-cpf-fail", status: "fail", verdict: null, evidence: [imageEv("run-cpf-fail", 1, "bug")] },
      ],
      "run-cpf-fail",
    ),
    flowWithVerdict(
      "BUSCA-NADJ",
      "Fluxo não adjudicado",
      [{ runId: "run-nadj", status: "incomplete", verdict: null, evidence: [] }],
      "run-nadj",
    ),
    flowWithVerdict("BUSCA-EXC", "Fluxo excluído (mock/GEO)", [], ""),
  );

  const evidenceDirs = [
    ...SAT_IDS.map((id) => ({ scenario: `run-${id}`, absPath: `/abs/run-${id}`, pngs: ["step-1-open.png"], video: null })),
    { scenario: "run-cpf-pass", absPath: "/abs/run-cpf-pass", pngs: ["step-1-ok.png"], video: null },
    { scenario: "run-cpf-fail", absPath: "/abs/run-cpf-fail", pngs: ["step-1-bug.png"], video: null },
  ];

  return {
    source: { sessionDir: "/tmp/s", capabilityId: "busca", featureDir: "/tmp/s/features/busca" },
    feature: { id: "busca", name: "Busca" },
    specs: [],
    storiesAcs: [],
    synths: { endpoints: [], entities: [], tables: [], form_components: [], form_conditionals: [] },
    decisions: [],
    // Only ONE scenario references a flow_id — this is exactly the gap: the
    // §Casos drill (scenario.flow_id-keyed) would cover at most this one flow.
    scenarios: [{ id: "SC-BUSCA-1", name: "Busca básica", flow_id: "BUSCA-1", cites: [] }],
    plans: [],
    findings: [],
    checkpoints: { A: null, B: null, C: null },
    evidenceDirs,
    runflowDir: null,
    flowsWithVerdicts,
    unattachedVerdicts: [],
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
    adjudicated: ADJ,
  } as AdjudicatedSiteInputs;
}

/** The verdict runId a flow's row carries (single source to compare against). */
function verdictRunId(inputs: AdjudicatedSiteInputs, flowId: string): string {
  const fwv = inputs.flowsWithVerdicts.find(
    (f) => String(((f as Record<string, unknown>)["flow"] as Record<string, unknown>)["id"]) === flowId,
  )!;
  return String(((fwv as Record<string, unknown>)["verdict"] as Record<string, unknown>)["runId"]);
}

/** Count the rendered proving-run drills — one `data-drill-status` per drill. */
function countDrills(html: string): number {
  return (html.match(/data-drill-status=/g) ?? []).length;
}

/** The adjudicated flows (satisfied / violated / contradictory) in the map. */
function adjudicatedFlows(): string[] {
  return Object.entries(FLOW_STATUS)
    .filter(([, s]) => s === "satisfied" || s === "violated" || s === "contradictory")
    .map(([id]) => id);
}

describe("per-flow surface — every adjudicated flow drills to its proving run", () => {
  test("one row per flowStatus entry, each carrying its STATUS pill", () => {
    const html = renderPerFlow(makeInputs());
    const rows = html.match(/class="pf-row"/g) ?? [];
    // 7 satisfied + contradictory + not_adjudicated + excluded = 10 rows.
    expect(rows.length).toBe(Object.keys(FLOW_STATUS).length);
    // The status pills are present (Coberto for satisfied, Integridade for the
    // contradictory, Não executado for not_adjudicated, Excluído for excluded).
    expect(html).toContain(">Coberto<");
    expect(html).toContain(">Integridade<");
    expect(html).toContain(">Não executado<");
    expect(html).toContain(">Excluído<");
  });

  test("each adjudicated flow has a drill whose data-proving-run == its verdict runId", () => {
    const inputs = makeInputs();
    const html = renderPerFlow(inputs);
    for (const id of SAT_IDS) {
      expect(html).toContain(`data-flow="${id}"`);
      expect(html).toContain(`data-proving-run="${verdictRunId(inputs, id)}"`);
    }
  });

  test("the contradictory flow shows BOTH runs (never one hidden)", () => {
    const html = renderPerFlow(makeInputs());
    expect(html).toContain('data-flow="BUSCA-CPF"');
    expect(html).toContain('data-proving-run="run-cpf-pass"');
    expect(html).toContain('data-proving-run="run-cpf-fail"');
    expect(html).toContain("drill-both");
  });

  test("a not_adjudicated / excluded flow shows status but NO drill", () => {
    const html = renderPerFlow(makeInputs());
    // Rows exist for both, carrying their status (data-pf-flow = row anchor)…
    expect(html).toContain('data-pf-flow="BUSCA-NADJ"');
    expect(html).toContain('data-pf-flow="BUSCA-EXC"');
    // …but neither carries a proving-run drill (data-flow = drill anchor; no
    // fabricated evidence).
    expect(html).not.toContain('data-flow="BUSCA-NADJ"');
    expect(html).not.toContain('data-flow="BUSCA-EXC"');
    expect(html).not.toContain('data-proving-run="run-nadj"');
    expect(html).not.toContain('data-drill-status="not_adjudicated"');
    expect(html).not.toContain('data-drill-status="excluded"');
  });

  test("COVERAGE-COMPLETENESS: #adjudicated-drills == #adjudicated-flows (non-vacuous)", () => {
    const html = renderPerFlow(makeInputs());
    const expected = adjudicatedFlows().length;
    // Non-vacuous: there ARE multiple adjudicated flows (busca = 8), and EACH
    // is drilled — not merely ≥1. The old scenario.flow_id keying drilled 2/8.
    expect(expected).toBe(8);
    expect(countDrills(html)).toBe(expected);
  });
});
