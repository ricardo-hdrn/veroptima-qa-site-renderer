/**
 * Verdict-anchored evidence DRILL — the replacement for the old flat per-feature
 * carousel (which keyed evidenceDirs by scenario id and rendered 0 slides because
 * evidenceDir.scenario === runId, never the scenario id).
 *
 * Each per-flow body status cell drills to the RUN that PROVED its verdict →
 * that run's ordered STEPS → each step's step-anchored SCREENSHOT. Everything is
 * single-sourced from `flowsWithVerdicts` / `evidenceDirs`; nothing is invented.
 *
 * ── THE PROVING-RUN RULE (deterministic, single-source) ──────────────────────
 * For a flow F, the proving run(s) come from `flowsWithVerdicts[F].tries[]`
 * (ordered emittedAt-ASC; `.verdict` is the latest). Selection is driven by the
 * flow's ADJUDICATED status (`adjudicated.flowStatus[F]` — the SAME source the
 * body status cell's % is computed from, so the drill's runId is the SAME runId
 * the verdict row carries):
 *
 *   - satisfied      (Coberto)      → the LAST `pass` try's runId.
 *   - violated       (Falhou)       → the LAST `fail` try's runId.
 *   - contradictory  (Integridade)  → BOTH: the last `pass` run AND the last
 *                                     `fail` run, rendered side by side — the
 *                                     contradiction IS the finding; we NEVER
 *                                     pick one and hide the other.
 *   - blocked / not_adjudicated / excluded / unmapped (or no flow entry / no
 *     matching try) → NO proving run → NO drill (we render no fabricated
 *     evidence; the cell keeps its existing state).
 *
 * The chosen runId is therefore the SAME run the corresponding verdict row
 * carries. The drill element exposes it as `data-proving-run` (machine-
 * extractable for the Part-3 gate: drill-run-id == verdict-run-id), alongside
 * `data-flow`.
 */
import { readFlowStatus } from "./coverage.js";
import { esc } from "./escape.js";
import type { AdjudicatedFlowStatus, SiteInputs } from "./types.js";

/** Role a proving run plays in the drill (drives the side-by-side label). */
export type ProvingRole = "satisfied" | "violated" | "single";

/** One step of a proving run: a screenshot + its action label, step-anchored. */
export interface DrillStep {
  /** Step index parsed from the filename; null when unanchored (sorted last). */
  stepIndex: number | null;
  /** Filename basename — the UI label (`step-NNN-<action>.png`). */
  basename: string;
  /** The parsed `<action>` slug (best-effort from the basename). */
  action: string;
  /** Relative URL under the output dir, or null when no screenshot on disk. */
  imageRel: string | null;
}

/** One proving run's drill panel — its steps + run/scenario details. */
export interface DrillRun {
  runId: string;
  role: ProvingRole;
  /** Flow-verdict status of the chosen try: pass | incomplete | fail. */
  status: string;
  /** The evidence-dir scenario the run's captures live under (=== runId). */
  scenario: string;
  steps: DrillStep[];
  /** true when ≥1 step carries a screenshot; false → honest "no captures". */
  hasEvidence: boolean;
  /** Optional session video, when the run's evidence dir carries one. */
  videoRel: string | null;
}

/** A flow's complete drill: 0 runs (no drill), 1 (sat/vio), or 2 (contradictory). */
export interface FlowDrill {
  flowId: string;
  status: AdjudicatedFlowStatus;
  runs: DrillRun[];
}

type FlowTry = {
  runId: string;
  status: "pass" | "incomplete" | "fail";
  evidence: Array<{ basename: string; kind: string; stepIndex: number | null }>;
};

type EvidenceDir = {
  scenario: string;
  pngs: string[];
  video: string | null;
};

/** Find the FlowWithVerdict entry whose `flow.id === flowId`. */
function findFlowEntry(inputs: SiteInputs, flowId: string): { tries: FlowTry[] } | null {
  for (const fwv of inputs.flowsWithVerdicts) {
    const flow = (fwv as Record<string, unknown>)["flow"];
    const id = flow && typeof flow === "object" ? String((flow as Record<string, unknown>)["id"] ?? "") : "";
    if (id === flowId) {
      const tries = Array.isArray((fwv as Record<string, unknown>)["tries"])
        ? ((fwv as Record<string, unknown>)["tries"] as FlowTry[])
        : [];
      return { tries };
    }
  }
  return null;
}

/** Last try (emittedAt-ASC order) matching a status — i.e. the adjudicating run. */
function lastTryWithStatus(tries: FlowTry[], status: FlowTry["status"]): FlowTry | null {
  for (let i = tries.length - 1; i >= 0; i--) {
    if (tries[i]!.status === status) return tries[i]!;
  }
  return null;
}

/**
 * Parse the `<action>` slug from a step-anchored basename:
 *   - `step-3-validation.png` → "validation"
 *   - `001-submit.png`        → "submit"
 *   - `submit.png`            → "submit"
 * Best-effort; returns the de-extensioned, de-numbered remainder.
 */
export function parseStepAction(basename: string): string {
  const noExt = basename.replace(/\.[a-z0-9]+$/i, "");
  const noStepWord = noExt.replace(/^step[-_]/i, "");
  const noLeadingNum = noStepWord.replace(/^\d+[-_]/, "");
  return noLeadingNum || noExt;
}

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Build the ordered DrillSteps for one proving run. */
function buildSteps(run: FlowTry, evDir: EvidenceDir | undefined): { steps: DrillStep[]; hasEvidence: boolean } {
  const base = `evidence/${encodeURIComponent(run.runId)}/`;

  // Prefer the try's step-anchored evidence artifacts (image kind).
  const images = run.evidence.filter((e) => e.kind === "image");
  if (images.length > 0) {
    const steps = [...images]
      .sort(byStepIndex((e) => e.stepIndex))
      .map<DrillStep>((e) => ({
        stepIndex: e.stepIndex,
        basename: e.basename,
        action: parseStepAction(e.basename),
        imageRel: base + encodeURIComponent(e.basename),
      }));
    return { steps, hasEvidence: true };
  }

  // Fall back to the run's evidence dir pngs (keyed by scenario === runId), in
  // step order parsed from the basenames.
  if (evDir && evDir.pngs.length > 0) {
    const steps = [...evDir.pngs]
      .map((p) => ({ p, idx: parseStepIndexFromName(p) }))
      .sort(byStepIndex((x) => x.idx))
      .map<DrillStep>(({ p, idx }) => ({
        stepIndex: idx,
        basename: p,
        action: parseStepAction(p),
        imageRel: base + encodeURIComponent(p),
      }));
    return { steps, hasEvidence: true };
  }

  // No screenshots on disk for this run — honest empty (never invented).
  return { steps: [], hasEvidence: false };
}

/** Parse a step index out of a bare filename (mirrors the reader convention). */
function parseStepIndexFromName(name: string): number | null {
  const m1 = name.match(/^step[-_](\d+)/i);
  if (m1) return parseInt(m1[1]!, 10);
  const m2 = name.match(/^(\d+)[-_]/);
  if (m2) return parseInt(m2[1]!, 10);
  return null;
}

/** Comparator: ascending stepIndex; nulls (unanchored) sorted last, stable. */
function byStepIndex<T>(key: (t: T) => number | null): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka - kb;
  };
}

/** Assemble one DrillRun from a chosen try, joining the evidence dir by runId. */
function buildRun(inputs: SiteInputs, run: FlowTry, role: ProvingRole): DrillRun {
  const evDir = (inputs.evidenceDirs as EvidenceDir[]).find((d) => d.scenario === run.runId);
  const { steps, hasEvidence } = buildSteps(run, evDir);
  const videoRel = evDir && evDir.video ? `evidence/${encodeURIComponent(run.runId)}/${encodeURIComponent(evDir.video)}` : null;
  return { runId: run.runId, role, status: run.status, scenario: run.runId, steps, hasEvidence, videoRel };
}

/**
 * Build the verdict-anchored drill for a flow, applying the proving-run rule.
 * Returns `null` when the flow has no proving run (no drill, no fabrication).
 */
export function buildFlowDrill(inputs: SiteInputs, flowId: string): FlowDrill | null {
  if (!flowId) return null;
  const status = readFlowStatus(inputs)?.[flowId];
  if (!status) return null;

  const entry = findFlowEntry(inputs, flowId);
  if (!entry) return null;
  const tries = entry.tries;

  const runs: DrillRun[] = [];
  if (status === "satisfied") {
    const t = lastTryWithStatus(tries, "pass");
    if (t) runs.push(buildRun(inputs, t, "single"));
  } else if (status === "violated") {
    const t = lastTryWithStatus(tries, "fail");
    if (t) runs.push(buildRun(inputs, t, "single"));
  } else if (status === "contradictory") {
    // BOTH runs — the contradiction IS the finding; never hide a side.
    const pass = lastTryWithStatus(tries, "pass");
    const fail = lastTryWithStatus(tries, "fail");
    if (pass) runs.push(buildRun(inputs, pass, "satisfied"));
    if (fail) runs.push(buildRun(inputs, fail, "violated"));
  }
  // blocked / not_adjudicated / excluded / unmapped → no proving run.

  if (runs.length === 0) return null;
  return { flowId, status, runs };
}

const ROLE_LABEL: Record<ProvingRole, string> = {
  satisfied: "Execução que passou (Coberto)",
  violated: "Execução que provou o bug (Falhou)",
  single: "Execução que provou o veredito",
};

/** Render one proving-run panel: details + ordered steps + screenshots. */
function renderRun(run: DrillRun): string {
  const stepsHtml =
    run.steps.length === 0
      ? `<p class="drill-empty faint">(nenhuma captura registrada para esta execução)</p>`
      : `<ol class="drill-steps">` +
        run.steps
          .map((s) => {
            const label = s.stepIndex !== null ? `step-${s.stepIndex}-${s.action}` : s.action;
            const img = s.imageRel
              ? `<a class="drill-shot" href="${esc(s.imageRel)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(s.imageRel)}" alt="${esc(label)}"></a>`
              : `<span class="drill-noimg faint">(sem captura)</span>`;
            return `<li class="drill-step"><div class="drill-step-h"><span class="drill-step-idx mono">${s.stepIndex !== null ? esc(String(s.stepIndex)) : "—"}</span><span class="drill-step-act mono">${esc(label)}</span></div>${img}</li>`;
          })
          .join("\n") +
        `</ol>`;
  const noShots = run.hasEvidence ? "" : `<p class="drill-empty faint">(nenhuma captura em disco para esta execução)</p>`;
  const video = run.videoRel
    ? `<a class="vid" href="${esc(run.videoRel)}" target="_blank" rel="noopener">▶ vídeo da sessão</a>`
    : "";
  return `
<div class="drill-run" data-proving-run="${esc(run.runId)}" data-proving-role="${esc(run.role)}">
  <div class="drill-run-h">
    <span class="drill-role">${esc(ROLE_LABEL[run.role])}</span>
    <dl class="drill-meta">
      <dt>run</dt><dd class="mono">${esc(run.runId)}</dd>
      <dt>scenario</dt><dd class="mono">${esc(run.scenario)}</dd>
      <dt>status</dt><dd class="mono">${esc(run.status)}</dd>
    </dl>
    ${video}
  </div>
  ${noShots}
  ${stepsHtml}
</div>`;
}

/**
 * Render the full drill for a flow (or "" when no proving run). The outer
 * element carries `data-flow`; each run panel carries `data-proving-run` —
 * single-sourced with the visible run id so the gate can assert
 * drill-run-id == verdict-run-id.
 */
export function renderFlowDrill(inputs: SiteInputs, flowId: string): string {
  const drill = buildFlowDrill(inputs, flowId);
  if (!drill) return "";
  const both = drill.runs.length > 1;
  return `
<dt>Execução que provou o veredito</dt>
<dd>
  <details class="drill${both ? " drill-both" : ""}" data-flow="${esc(drill.flowId)}" data-drill-status="${esc(drill.status)}">
    <summary class="drill-summary">Abrir a execução comprovante${both ? " (contradição: ambas as execuções)" : ""} ▾</summary>
    <div class="drill-runs">
      ${drill.runs.map(renderRun).join("\n")}
    </div>
  </details>
</dd>`;
}
