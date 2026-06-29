/**
 * Verdict-anchored evidence DRILL — the replacement for the old flat per-feature
 * carousel (which keyed evidenceDirs by scenario id and rendered 0 slides because
 * evidenceDir.scenario === runId, never the scenario id).
 *
 * Each per-flow body status cell drills to the RUN that PROVED its verdict →
 * that run's ordered STEPS → each step's step-anchored SCREENSHOT. The RUN is
 * selected from `adjudicated.flowProvingRuns` (the verdict-row source); the
 * step labels/screenshots are still joined from `flowsWithVerdicts` /
 * `evidenceDirs`. Nothing is invented.
 *
 * ── THE PROVING-RUN RULE (deterministic, single-source) ──────────────────────
 * For a flow F, the proving run(s) come from `adjudicated.flowProvingRuns[F]`
 * (`{ satisfiedRun?, violatedRun? }`) — emitted by the host from the SAME
 * verdict rows that classify `flowStatus`, so the run that satisfies/violates is
 * THE run the % source carries. Selection is keyed by the flow's ADJUDICATED
 * status (`adjudicated.flowStatus[F]`):
 *
 *   - satisfied      (Coberto)      → flowProvingRuns[F].satisfiedRun.
 *   - violated       (Falhou)       → flowProvingRuns[F].violatedRun.
 *   - contradictory  (Integridade)  → BOTH: satisfiedRun AND violatedRun,
 *                                     rendered side by side — the contradiction
 *                                     IS the finding; we NEVER pick one and hide
 *                                     the other.
 *   - blocked / not_adjudicated / excluded / unmapped (or no proving-run entry)
 *     → NO proving run → NO drill (we render no fabricated evidence; the cell
 *     keeps its existing state).
 *
 * Run selection NO LONGER depends on `tries[].status` (the pass/incomplete/fail
 * FlowVerdict vocab), which DIVERGED from `flowStatus`: a satisfied flow whose
 * tries carried no `pass` row used to render 0 drills even though the verdict
 * row proved it. The matching try (joined by runId) is still read for richer
 * step labels, but it does NOT drive selection.
 *
 * The chosen runId is therefore the SAME run the corresponding verdict row
 * carries. The drill element exposes it as `data-proving-run` (machine-
 * extractable for the Part-3 gate: drill-run-id == verdict-run-id), alongside
 * `data-flow`.
 */
import { readFlowProvingRuns, readFlowStatus } from "./coverage.js";
import { esc } from "./escape.js";
import { readRedactEvidenceImages } from "./types.js";
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

/** The try whose runId matches the chosen proving run (for richer step labels +
 *  its FlowVerdict status). `null` when no try carries that runId — selection is
 *  driven by flowProvingRuns, so the drill still renders from the evidence dir. */
function findTryByRunId(tries: FlowTry[], runId: string): FlowTry | null {
  for (const t of tries) if (t.runId === runId) return t;
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

/** Build the ordered DrillSteps for one proving run, joining by its runId.
 *  `tryEvidence` is the matching try's step-anchored artifacts (preferred for
 *  labels) when a try carries this runId; the evidence dir pngs are the
 *  fallback. Selection of the runId itself happens upstream (flowProvingRuns). */
function buildSteps(
  runId: string,
  tryEvidence: FlowTry["evidence"] | undefined,
  evDir: EvidenceDir | undefined,
): { steps: DrillStep[]; hasEvidence: boolean } {
  const base = `evidence/${encodeURIComponent(runId)}/`;

  // Prefer the matching try's step-anchored evidence artifacts (image kind).
  const images = (tryEvidence ?? []).filter((e) => e.kind === "image");
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

/**
 * Assemble one DrillRun for a runId chosen upstream (from flowProvingRuns),
 * joining the matching try (for richer step labels + its FlowVerdict status) and
 * the evidence dir (both by runId). `fallbackStatus` is shown when no try
 * carries this runId — selection no longer depends on a try existing.
 */
function buildRunById(
  inputs: SiteInputs,
  tries: FlowTry[],
  runId: string,
  role: ProvingRole,
  fallbackStatus: string,
): DrillRun {
  const matchTry = findTryByRunId(tries, runId);
  const evDir = (inputs.evidenceDirs as EvidenceDir[]).find((d) => d.scenario === runId);
  const { steps, hasEvidence } = buildSteps(runId, matchTry?.evidence, evDir);
  const videoRel = evDir && evDir.video ? `evidence/${encodeURIComponent(runId)}/${encodeURIComponent(evDir.video)}` : null;
  return {
    runId,
    role,
    status: matchTry?.status ?? fallbackStatus,
    scenario: runId,
    steps,
    hasEvidence,
    videoRel,
  };
}

/**
 * Build the verdict-anchored drill for a flow, applying the proving-run rule.
 * The proving run(s) are selected from `adjudicated.flowProvingRuns[flowId]`
 * (the verdict-row source), keyed by the flow's `flowStatus` — NOT from
 * `tries[].status`. Returns `null` when the flow has no proving run (no drill,
 * no fabrication).
 */
export function buildFlowDrill(inputs: SiteInputs, flowId: string): FlowDrill | null {
  if (!flowId) return null;
  const status = readFlowStatus(inputs)?.[flowId];
  if (!status) return null;

  const proving = readFlowProvingRuns(inputs)?.[flowId];
  const entry = findFlowEntry(inputs, flowId);
  const tries = entry?.tries ?? [];

  const runs: DrillRun[] = [];
  if (status === "satisfied") {
    const runId = proving?.satisfiedRun;
    if (runId) runs.push(buildRunById(inputs, tries, runId, "single", "pass"));
  } else if (status === "violated") {
    const runId = proving?.violatedRun;
    if (runId) runs.push(buildRunById(inputs, tries, runId, "single", "fail"));
  } else if (status === "contradictory") {
    // BOTH runs — the contradiction IS the finding; never hide a side.
    const satRun = proving?.satisfiedRun;
    const vioRun = proving?.violatedRun;
    if (satRun) runs.push(buildRunById(inputs, tries, satRun, "satisfied", "pass"));
    if (vioRun) runs.push(buildRunById(inputs, tries, vioRun, "violated", "fail"));
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

/**
 * Render one step's evidence tile. When `redacted` (the deploy-safe default) and
 * the step HAS a screenshot, emit a redaction placeholder INSTEAD of the
 * `<img src>` — the raw client pixels are gated, but the step's label/index are
 * rendered by the caller and stay visible. A step with no capture on disk shows
 * the honest "(sem captura)" either way (no pixels to gate).
 */
function renderStepImage(s: DrillStep, label: string, redacted: boolean): string {
  if (!s.imageRel) return `<span class="drill-noimg faint">(sem captura)</span>`;
  if (redacted) {
    return `<span class="drill-shot drill-redacted" data-redacted="true" title="${esc(label)}"><span class="drill-lock" aria-hidden="true">🔒</span> captura ocultada — acesso restrito</span>`;
  }
  return `<a class="drill-shot" href="${esc(s.imageRel)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(s.imageRel)}" alt="${esc(label)}"></a>`;
}

/** Render one proving-run panel: details + ordered steps + screenshots. When
 *  `redacted`, the raw screenshots/video are gated behind placeholders while
 *  every step label/index and the run meta stay visible. */
function renderRun(run: DrillRun, redacted: boolean): string {
  const stepsHtml =
    run.steps.length === 0
      ? `<p class="drill-empty faint">(nenhuma captura registrada para esta execução)</p>`
      : `<ol class="drill-steps">` +
        run.steps
          .map((s) => {
            const label = s.stepIndex !== null ? `step-${s.stepIndex}-${s.action}` : s.action;
            const img = renderStepImage(s, label, redacted);
            return `<li class="drill-step"><div class="drill-step-h"><span class="drill-step-idx mono">${s.stepIndex !== null ? esc(String(s.stepIndex)) : "—"}</span><span class="drill-step-act mono">${esc(label)}</span></div>${img}</li>`;
          })
          .join("\n") +
        `</ol>`;
  const noShots = run.hasEvidence ? "" : `<p class="drill-empty faint">(nenhuma captura em disco para esta execução)</p>`;
  const video = run.videoRel
    ? redacted
      ? `<span class="vid vid-redacted faint" data-redacted="true"><span class="drill-lock" aria-hidden="true">🔒</span> vídeo ocultado — acesso restrito</span>`
      : `<a class="vid" href="${esc(run.videoRel)}" target="_blank" rel="noopener">▶ vídeo da sessão</a>`
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
  // Deploy-security gate: ON by default (raw client screenshots/video gated).
  // The drill STRUCTURE/METADATA/COUNTS stay visible regardless; only the pixels
  // are placeholdered. `data-evidence-redacted` makes the state machine-checkable.
  const redacted = readRedactEvidenceImages(inputs);
  const redactedNote = redacted
    ? `<p class="drill-redacted-note faint">🔒 Capturas ocultadas — acesso restrito (estrutura, passos e ids do run permanecem visíveis).</p>`
    : "";
  return `
<dt>Execução que provou o veredito</dt>
<dd>
  <details class="drill${both ? " drill-both" : ""}${redacted ? " drill-evidence-redacted" : ""}" data-flow="${esc(drill.flowId)}" data-drill-status="${esc(drill.status)}" data-evidence-redacted="${redacted ? "true" : "false"}">
    <summary class="drill-summary">Abrir a execução comprovante${both ? " (contradição: ambas as execuções)" : ""} ▾</summary>
    ${redactedNote}
    <div class="drill-runs">
      ${drill.runs.map((r) => renderRun(r, redacted)).join("\n")}
    </div>
  </details>
</dd>`;
}
