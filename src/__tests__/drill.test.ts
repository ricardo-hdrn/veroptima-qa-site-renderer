/**
 * Verdict-anchored evidence DRILL — proving-run selection + single-source.
 *
 * The drill replaces the old flat per-scenario carousel. Each per-flow status
 * cell drills to the RUN that PROVED its verdict → that run's ordered steps →
 * step-anchored screenshots. These tests pin:
 *
 *   1. satisfied  → the LAST `pass` try's runId (drill === that runId), steps +
 *      screenshots present.
 *   2. violated   → the LAST `fail` try's runId.
 *   3. contradictory → BOTH the last-pass AND the last-fail run, side by side.
 *   4. no proving run (not_adjudicated/excluded/unmapped/no try) → NO drill.
 *   5. single-source: the drill's runId === the verdict's runId.
 *   + MUTATION 1 (pick a non-proving run → data-proving-run != verdict runId)
 *     and MUTATION 2 (contradictory shows only one run) are exercised by
 *     temporarily editing drill.ts; both turn this suite RED. See the build
 *     report for the observed failures.
 */
import { describe, expect, test } from "bun:test";

import { buildFlowDrill, parseStepAction, renderFlowDrill } from "../drill.js";
import { renderSite } from "../render.js";
import type { AdjudicatedFlowStatus, AdjudicatedSiteInputs, SiteAdjudicatedKpis } from "../types.js";

const FIXED_TIME = "2026-06-09T12:00:00Z";

type TryEv = { path: string; basename: string; kind: "image" | "video" | "other"; stepIndex: number | null };
type Try = { runId: string; status: "pass" | "incomplete" | "fail"; startedAt?: string; verdict: Record<string, unknown> | null; evidence: TryEv[] };

function imageEv(runId: string, idx: number, action: string): TryEv {
  const basename = `step-${idx}-${action}.png`;
  return { path: `/abs/${runId}/${basename}`, basename, kind: "image", stepIndex: idx };
}

type FlowWithVerdict = AdjudicatedSiteInputs["flowsWithVerdicts"][number];

function flowWithVerdict(flowId: string, tries: Try[], latestRunId: string): FlowWithVerdict {
  return {
    flow: { id: flowId, title: flowId },
    // The latest persisted verdict carries the adjudicating runId — single source.
    verdict: { runId: latestRunId, status: tries.find((t) => t.runId === latestRunId)?.status ?? null },
    evidence: {},
    tries,
    assurance: {},
    cost: { authorTokens: 0, authorWallClockMs: 0, replayCost: 0 },
  } as FlowWithVerdict;
}

/**
 * A drill-shaped fixture:
 *   - FLOW-SAT  satisfied: tries [fail@run-s0, pass@run-s1, pass@run-s2] → last pass = run-s2
 *   - FLOW-VIO  violated:  tries [fail@run-v0, fail@run-v1]              → last fail = run-v1
 *   - FLOW-FLIP contradictory: tries [pass@run-c-pass, fail@run-c-fail] → BOTH
 *   - FLOW-NADJ not_adjudicated: tries [incomplete@run-n0]              → no drill
 */
const FLOW_STATUS: Record<string, AdjudicatedFlowStatus> = {
  "FLOW-SAT": "satisfied",
  "FLOW-VIO": "violated",
  "FLOW-FLIP": "contradictory",
  "FLOW-NADJ": "not_adjudicated",
};

const ADJ: SiteAdjudicatedKpis = {
  noAdjudicatedData: false,
  completude: { verified: 1, addressable: 4, pct: 25 },
  conformidade: { approved: 1, addressable: 4, pct: 25 },
  bugsApp: { count: 1, flows: ["FLOW-VIO"] },
  verdictIntegrity: { count: 1, flows: ["FLOW-FLIP"] },
  flowStatus: FLOW_STATUS,
};

function makeInputs(): AdjudicatedSiteInputs {
  return {
    source: { sessionDir: "/tmp/s", capabilityId: "drill", featureDir: "/tmp/s/features/drill" },
    feature: { id: "drill", name: "Drill" },
    specs: [],
    storiesAcs: [],
    synths: { endpoints: [], entities: [], tables: [], form_components: [], form_conditionals: [] },
    decisions: [],
    scenarios: [
      { id: "SC-SAT", name: "Satisfeita", flow_id: "FLOW-SAT", cites: [] },
      { id: "SC-VIO", name: "Violada", flow_id: "FLOW-VIO", cites: [] },
      { id: "SC-FLIP", name: "Contraditória", flow_id: "FLOW-FLIP", cites: [] },
      { id: "SC-NADJ", name: "Não adjudicada", flow_id: "FLOW-NADJ", cites: [] },
    ],
    plans: [
      {
        id: "PLAN-1",
        name: "Plano",
        status: "ticked",
        target_test_flow_ids: ["SC-SAT", "SC-VIO", "SC-FLIP", "SC-NADJ"],
        flow_ids: ["FLOW-SAT"],
      },
    ],
    findings: [],
    checkpoints: { A: null, B: null, C: null },
    evidenceDirs: [
      // run-s2 has step-anchored pngs on disk (for the evidenceDir fallback path).
      { scenario: "run-s2", absPath: "/abs/run-s2", pngs: ["step-1-open.png", "step-2-submit.png"], video: "session.webm" },
      { scenario: "run-v1", absPath: "/abs/run-v1", pngs: ["step-1-open.png"], video: null },
      { scenario: "run-c-pass", absPath: "/abs/run-c-pass", pngs: ["step-1-ok.png"], video: null },
      { scenario: "run-c-fail", absPath: "/abs/run-c-fail", pngs: ["step-1-bug.png"], video: null },
    ],
    runflowDir: null,
    flowsWithVerdicts: [
      flowWithVerdict(
        "FLOW-SAT",
        [
          { runId: "run-s0", status: "fail", verdict: null, evidence: [] },
          { runId: "run-s1", status: "pass", verdict: null, evidence: [imageEv("run-s1", 1, "open")] },
          {
            runId: "run-s2",
            status: "pass",
            verdict: null,
            evidence: [imageEv("run-s2", 1, "open"), imageEv("run-s2", 2, "submit")],
          },
        ],
        "run-s2",
      ),
      flowWithVerdict(
        "FLOW-VIO",
        [
          { runId: "run-v0", status: "fail", verdict: null, evidence: [] },
          { runId: "run-v1", status: "fail", verdict: null, evidence: [imageEv("run-v1", 1, "open")] },
        ],
        "run-v1",
      ),
      flowWithVerdict(
        "FLOW-FLIP",
        [
          { runId: "run-c-pass", status: "pass", verdict: null, evidence: [imageEv("run-c-pass", 1, "ok")] },
          { runId: "run-c-fail", status: "fail", verdict: null, evidence: [imageEv("run-c-fail", 1, "bug")] },
        ],
        "run-c-fail",
      ),
      flowWithVerdict(
        "FLOW-NADJ",
        [{ runId: "run-n0", status: "incomplete", verdict: null, evidence: [] }],
        "run-n0",
      ),
    ],
    unattachedVerdicts: [],
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
    adjudicated: ADJ,
  };
}

/** The verdict runId a flow's row carries (single source of truth to compare). */
function verdictRunId(inputs: AdjudicatedSiteInputs, flowId: string): string {
  const fwv = inputs.flowsWithVerdicts.find(
    (f) => String(((f as Record<string, unknown>)["flow"] as Record<string, unknown>)["id"]) === flowId,
  )!;
  return String(((fwv as Record<string, unknown>)["verdict"] as Record<string, unknown>)["runId"]);
}

describe("drill — proving-run selection", () => {
  test("satisfied → the LAST pass try's runId, with steps + screenshots", () => {
    const inputs = makeInputs();
    const drill = buildFlowDrill(inputs, "FLOW-SAT");
    expect(drill).not.toBeNull();
    expect(drill!.runs.length).toBe(1);
    // LAST pass (run-s2), NOT the earlier run-s1 pass.
    expect(drill!.runs[0]!.runId).toBe("run-s2");
    // Steps from the try's step-anchored evidence, ordered.
    expect(drill!.runs[0]!.steps.map((s) => s.stepIndex)).toEqual([1, 2]);
    expect(drill!.runs[0]!.steps.every((s) => s.imageRel !== null)).toBe(true);
    expect(drill!.runs[0]!.hasEvidence).toBe(true);

    const html = renderFlowDrill(inputs, "FLOW-SAT");
    expect(html).toContain('data-flow="FLOW-SAT"');
    expect(html).toContain('data-proving-run="run-s2"');
    expect(html).toContain("step-1-open");
    expect(html).toContain("step-2-submit");
    expect(html).toContain("evidence/run-s2/");
  });

  test("violated → the LAST fail try's runId", () => {
    const inputs = makeInputs();
    const drill = buildFlowDrill(inputs, "FLOW-VIO");
    expect(drill!.runs.length).toBe(1);
    expect(drill!.runs[0]!.runId).toBe("run-v1");
    expect(renderFlowDrill(inputs, "FLOW-VIO")).toContain('data-proving-run="run-v1"');
  });

  test("contradictory → BOTH last-pass AND last-fail, side by side (never one hidden)", () => {
    const inputs = makeInputs();
    const drill = buildFlowDrill(inputs, "FLOW-FLIP");
    expect(drill!.runs.length).toBe(2);
    const ids = drill!.runs.map((r) => r.runId).sort();
    expect(ids).toEqual(["run-c-fail", "run-c-pass"]);
    // Roles label which side is which — the contradiction IS the finding.
    expect(drill!.runs.find((r) => r.role === "satisfied")!.runId).toBe("run-c-pass");
    expect(drill!.runs.find((r) => r.role === "violated")!.runId).toBe("run-c-fail");

    const html = renderFlowDrill(inputs, "FLOW-FLIP");
    expect(html).toContain('data-proving-run="run-c-pass"');
    expect(html).toContain('data-proving-run="run-c-fail"');
    expect(html).toContain("drill-both");
  });

  test("no proving run (not_adjudicated) → NO drill, no fabricated evidence", () => {
    const inputs = makeInputs();
    expect(buildFlowDrill(inputs, "FLOW-NADJ")).toBeNull();
    expect(renderFlowDrill(inputs, "FLOW-NADJ")).toBe("");
  });

  test("unmapped / unknown flow → NO drill", () => {
    const inputs = makeInputs();
    expect(buildFlowDrill(inputs, "FLOW-GHOST")).toBeNull();
    expect(buildFlowDrill(inputs, "")).toBeNull();
  });
});

describe("drill — single-source (drill runId === verdict runId)", () => {
  test("satisfied / violated / contradictory drills carry exactly the verdict runIds", () => {
    const inputs = makeInputs();

    // satisfied + violated: the one proving run === the flow's verdict runId.
    expect(buildFlowDrill(inputs, "FLOW-SAT")!.runs[0]!.runId).toBe(verdictRunId(inputs, "FLOW-SAT"));
    expect(buildFlowDrill(inputs, "FLOW-VIO")!.runs[0]!.runId).toBe(verdictRunId(inputs, "FLOW-VIO"));

    // contradictory: the latest verdict runId MUST be one of the two drill runs
    // (the fail side here), and the pass side is the last-pass try.
    const flip = buildFlowDrill(inputs, "FLOW-FLIP")!;
    const flipRunIds = flip.runs.map((r) => r.runId);
    expect(flipRunIds).toContain(verdictRunId(inputs, "FLOW-FLIP"));
    expect(flip.runs.find((r) => r.role === "violated")!.runId).toBe(verdictRunId(inputs, "FLOW-FLIP"));
  });

  test("rendered data-proving-run is single-sourced with the visible run id", () => {
    const inputs = makeInputs();
    const html = renderFlowDrill(inputs, "FLOW-SAT");
    // The machine anchor and the human-visible <dd> run id are the same string.
    expect(html).toContain('data-proving-run="run-s2"');
    expect(html).toMatch(/<dd class="mono">run-s2<\/dd>/);
  });
});

describe("drill — rendered into the §Casos status cells", () => {
  test("the satisfied scenario cell drills to its last-pass run; violated to its last-fail", async () => {
    const out = await renderSite(makeInputs());
    // The drill anchors are present in the full document, single-sourced per flow.
    expect(out.html).toContain('data-flow="FLOW-SAT"');
    expect(out.html).toContain('data-proving-run="run-s2"');
    expect(out.html).toContain('data-flow="FLOW-VIO"');
    expect(out.html).toContain('data-proving-run="run-v1"');
    // Contradictory drills BOTH runs.
    expect(out.html).toContain('data-flow="FLOW-FLIP"');
    expect(out.html).toContain('data-proving-run="run-c-pass"');
    expect(out.html).toContain('data-proving-run="run-c-fail"');
    // not_adjudicated flow has NO drill anchor.
    expect(out.html).not.toContain('data-flow="FLOW-NADJ"');
  });

  test("a run with no evidence on disk renders the steps honestly, no invented images", () => {
    const inputs = makeInputs();
    // Strip run-v1's evidence dir AND its try evidence → honest empty.
    inputs.evidenceDirs = inputs.evidenceDirs.filter((d) => d.scenario !== "run-v1");
    const fwv = inputs.flowsWithVerdicts.find(
      (f) => String(((f as Record<string, unknown>)["flow"] as Record<string, unknown>)["id"]) === "FLOW-VIO",
    )! as Record<string, unknown>;
    (fwv["tries"] as Try[]).forEach((t) => (t.evidence = []));
    const drill = buildFlowDrill(inputs, "FLOW-VIO")!;
    expect(drill.runs[0]!.hasEvidence).toBe(false);
    expect(drill.runs[0]!.steps.length).toBe(0);
    const html = renderFlowDrill(inputs, "FLOW-VIO");
    // Still anchored to the proving run; honest "no captures" message.
    expect(html).toContain('data-proving-run="run-v1"');
    expect(html).toContain("nenhuma captura");
  });
});

describe("drill — parseStepAction", () => {
  test("strips step word + leading number + extension", () => {
    expect(parseStepAction("step-3-validation.png")).toBe("validation");
    expect(parseStepAction("001-submit.png")).toBe("submit");
    expect(parseStepAction("login.png")).toBe("login");
  });
});
