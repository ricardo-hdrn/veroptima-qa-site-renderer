/**
 * Evidence-image REDACTION toggle (deploy-security gate).
 *
 * The evidence drill embeds REAL client-app screenshots (+ an optional session
 * video). Until the deployed-site access model is confirmed, the site must ship
 * with those raw pixels GATED by DEFAULT — the drill STRUCTURE/METADATA/COUNTS
 * (run ids, `step-NNN-<action>` labels, scenario/run details, step counts) stay
 * VISIBLE; only the `<img src>`/video is replaced with a placeholder. These
 * tests pin:
 *
 *   1. DEFAULT (no flag) → images REDACTED: no real `<img src>` to a png, the
 *      placeholder is present, `data-evidence-redacted="true"`; the drill
 *      structure / run-id / step-labels / counts are STILL present.
 *   2. Flag OFF (explicit `false`) → real `<img>`/video rendered,
 *      `data-evidence-redacted="false"`, no placeholder.
 *
 * MUTATION (flip the `readRedactEvidenceImages` default from ON to OFF): a
 * render without the flag would expose the raw screenshots → test #1 FAILS.
 * Restore → green. The default MUST be ON (safe).
 */
import { describe, expect, test } from "bun:test";

import { renderFlowDrill } from "../drill.js";
import { renderSite } from "../render.js";
import { readRedactEvidenceImages } from "../types.js";
import type { AdjudicatedFlowStatus, AdjudicatedSiteInputs, RedactableSiteInputs, SiteAdjudicatedKpis } from "../types.js";

const FIXED_TIME = "2026-06-09T12:00:00Z";

type TryEv = { path: string; basename: string; kind: "image" | "video" | "other"; stepIndex: number | null };
function imageEv(runId: string, idx: number, action: string): TryEv {
  const basename = `step-${idx}-${action}.png`;
  return { path: `/abs/${runId}/${basename}`, basename, kind: "image", stepIndex: idx };
}

const FLOW_STATUS: Record<string, AdjudicatedFlowStatus> = { "FLOW-SAT": "satisfied" };
const ADJ: SiteAdjudicatedKpis = {
  noAdjudicatedData: false,
  completude: { verified: 1, addressable: 1, pct: 100 },
  conformidade: { approved: 1, addressable: 1, pct: 100 },
  bugsApp: { count: 0, flows: [] },
  verdictIntegrity: { count: 0, flows: [] },
  flowStatus: FLOW_STATUS,
  flowProvingRuns: { "FLOW-SAT": { satisfiedRun: "run-s2" } },
};

/** A drill-shaped fixture: FLOW-SAT proven by run-s2 with 2 step screenshots
 *  + a session video on disk. `redactEvidenceImages` is left UNSET by default
 *  so the deploy-safe default (ON) governs. */
function makeInputs(redactEvidenceImages?: boolean): RedactableSiteInputs {
  const base: AdjudicatedSiteInputs = {
    source: { sessionDir: "/tmp/s", capabilityId: "drill", featureDir: "/tmp/s/features/drill" },
    feature: { id: "drill", name: "Drill" },
    specs: [],
    storiesAcs: [],
    synths: { endpoints: [], entities: [], tables: [], form_components: [], form_conditionals: [] },
    decisions: [],
    scenarios: [{ id: "SC-SAT", name: "Satisfeita", flow_id: "FLOW-SAT", cites: [] }],
    plans: [
      { id: "PLAN-1", name: "Plano", status: "ticked", target_test_flow_ids: ["SC-SAT"], flow_ids: ["FLOW-SAT"] },
    ],
    findings: [],
    checkpoints: { A: null, B: null, C: null },
    evidenceDirs: [
      { scenario: "run-s2", absPath: "/abs/run-s2", pngs: ["step-1-open.png", "step-2-submit.png"], video: "session.webm" },
    ],
    runflowDir: null,
    flowsWithVerdicts: [
      {
        flow: { id: "FLOW-SAT", title: "FLOW-SAT" },
        verdict: { runId: "run-s2", status: "pass" },
        evidence: {},
        tries: [
          {
            runId: "run-s2",
            status: "pass",
            verdict: null,
            evidence: [imageEv("run-s2", 1, "open"), imageEv("run-s2", 2, "submit")],
          },
        ],
        assurance: {},
        cost: { authorTokens: 0, authorWallClockMs: 0, replayCost: 0 },
      } as AdjudicatedSiteInputs["flowsWithVerdicts"][number],
    ],
    unattachedVerdicts: [],
    builtAtIso: FIXED_TIME,
    locale: "pt-BR",
    adjudicated: ADJ,
  };
  return redactEvidenceImages === undefined
    ? (base as RedactableSiteInputs)
    : { ...base, redactEvidenceImages };
}

describe("evidence redaction — reader default", () => {
  test("DEFAULT is ON: absent flag → redacted (safe)", () => {
    expect(readRedactEvidenceImages(makeInputs())).toBe(true);
  });
  test("a non-false value still redacts (only explicit false opens)", () => {
    expect(readRedactEvidenceImages(makeInputs(true))).toBe(true);
    expect(readRedactEvidenceImages({ ...makeInputs(), redactEvidenceImages: "yes" } as unknown as RedactableSiteInputs)).toBe(true);
  });
  test("explicit false opens", () => {
    expect(readRedactEvidenceImages(makeInputs(false))).toBe(false);
  });
});

describe("evidence redaction — DEFAULT (no flag) gates the raw pixels", () => {
  test("no real <img src> to a png; placeholder present; data-evidence-redacted=true", () => {
    const html = renderFlowDrill(makeInputs(), "FLOW-SAT");
    // The drill section advertises the redacted state for the machine gate.
    expect(html).toContain('data-evidence-redacted="true"');
    // The raw pixels are GATED — no real <img> tag, no png src.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('src="evidence/run-s2/');
    // The redaction placeholder is present (image + video).
    expect(html).toContain("captura ocultada");
    expect(html).toContain("vídeo ocultado");
    expect(html).not.toContain('<a class="vid"');
  });

  test("the drill STRUCTURE / run-id / step-labels / counts STAY visible", () => {
    const html = renderFlowDrill(makeInputs(), "FLOW-SAT");
    // run id (data anchor + visible <dd>), scenario, status — all still rendered.
    expect(html).toContain('data-flow="FLOW-SAT"');
    expect(html).toContain('data-proving-run="run-s2"');
    expect(html).toMatch(/<dd class="mono">run-s2<\/dd>/);
    // step-NNN-<action> labels + their indices (the step COUNT = 2).
    expect(html).toContain("step-1-open");
    expect(html).toContain("step-2-submit");
    expect((html.match(/drill-step\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the full site renders redacted by default (no png <img>, anchor present)", async () => {
    const out = await renderSite(makeInputs());
    expect(out.html).toContain('data-evidence-redacted="true"');
    expect(out.html).not.toContain('<img loading="lazy" src="evidence/');
    expect(out.html).toContain("captura ocultada");
    // Structure still present.
    expect(out.html).toContain('data-proving-run="run-s2"');
    expect(out.html).toContain("step-2-submit");
  });
});

describe("evidence redaction — flag OFF renders the real evidence", () => {
  test("explicit false → real <img>/video; data-evidence-redacted=false; no placeholder", () => {
    const html = renderFlowDrill(makeInputs(false), "FLOW-SAT");
    expect(html).toContain('data-evidence-redacted="false"');
    // The real screenshots + video link are rendered.
    expect(html).toContain('<img loading="lazy" src="evidence/run-s2/step-1-open.png"');
    expect(html).toContain('<img loading="lazy" src="evidence/run-s2/step-2-submit.png"');
    expect(html).toContain('<a class="vid" href="evidence/run-s2/session.webm"');
    // No redaction placeholder.
    expect(html).not.toContain("captura ocultada");
    expect(html).not.toContain("vídeo ocultado");
  });
});
