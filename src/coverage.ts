/**
 * Shared coverage-derivation logic. Every section that needs to answer
 * "what's the status of decision X / scenario Y / AC Z?" goes through this
 * module so the §Painel heatmap, §Cobertura Detalhada table, and §08 KPIs
 * stay consistent.
 *
 * Status precedence (worst wins for bug, best wins otherwise):
 *   bug > ok > partial > blocked > gap
 *
 * Scenario status:
 *   - parent plan's status (ticked → ok, split → partial, blocked → blocked)
 *   - overridden to "bug" if a finding.kind="bug" carries an evidence_refs
 *     entry whose path/label contains the scenario id (extractScenarioIds)
 *
 * Decision status:
 *   - explicit `decision.evidence_scenario_ids` join (when persisted) OR
 *   - code-cite overlap join (decision.cites ↔ scenario.cites: same file +
 *     line-range intersect) OR doc-cite equality
 *   - status = merge of every linked scenario status
 *
 * AC status: max-of-decisions-citing-this-ac via `cite.ac_id`.
 */
import { readAdjudicated, type AdjudicatedFlowStatus, type SiteInputs } from "./types.js";

/**
 * The body status vocabulary. The first five are the synth (design-intent)
 * cuts. The last four are GROUNDED-only, derived from the per-goal verdict map
 * (`adjudicated.flowStatus`) via the item→flow join:
 *   - failed         — a violated verdict                (Falhou)
 *   - contradictory  — a contradictory/flip goal         (integrity note)
 *   - unmapped       — item has NO flow ref, OR its flow id is absent from the
 *                      verdict map → SEM MAPEAMENTO (the loud honesty gap;
 *                      NEVER silently bucketed as "Não executado")
 *   - misto          — item joins MULTIPLE flows with CONFLICTING statuses
 */
export type CoverStatus =
  | "ok"
  | "partial"
  | "blocked"
  | "gap"
  | "bug"
  | "failed"
  | "contradictory"
  | "unmapped"
  | "misto";

const STATUS_RANK: Record<CoverStatus, number> = {
  ok: 4,
  partial: 3,
  blocked: 2,
  gap: 1,
  bug: 0,
  // Grounded-only cuts never participate in the synth `mergeStatus` precedence
  // (they are produced only by the grounded join below); ranked low for safety.
  failed: 0,
  contradictory: 1,
  misto: 1,
  unmapped: 0,
};

/** Visible label + pill class for every status — SINGLE SOURCE so the human
 *  label and the machine `data-v` can never diverge. */
export const COVER_LABEL: Record<CoverStatus, string> = {
  ok: "Coberto",
  partial: "Parcial",
  blocked: "Bloqueado",
  gap: "Não executado",
  bug: "Bug",
  failed: "Falhou",
  contradictory: "Integridade",
  unmapped: "Sem mapeamento",
  misto: "Misto",
};

export const COVER_CLASS: Record<CoverStatus, string> = {
  ok: "pill-ok",
  partial: "pill-partial",
  blocked: "pill-blocked",
  gap: "pill-gap",
  bug: "pill-bug",
  failed: "pill-failed",
  contradictory: "pill-contradictory",
  unmapped: "pill-unmapped",
  misto: "pill-misto",
};

export function mergeStatus(
  current: CoverStatus | null,
  candidate: CoverStatus,
): CoverStatus {
  if (current === "bug" || candidate === "bug") return "bug";
  if (current === null) return candidate;
  return STATUS_RANK[candidate] > STATUS_RANK[current] ? candidate : current;
}

export function planStatusToCut(s: unknown): CoverStatus {
  if (s === "ticked") return "ok";
  if (s === "split") return "partial";
  if (s === "blocked") return "blocked";
  return "gap";
}

/** Extract scenario IDs from a finding.evidence_refs entry, handling the
 *  variety of shapes that may have been persisted across runs:
 *   - "SC-CC-CNPJ-ALNUM-NEEDLE"                             (bare string)
 *   - { scenario_id: "SC-..." }                              (typed)
 *   - { scenarios: ["SC-A", "SC-B"] }                        (typed multi)
 *   - { kind: "transcript", path: "app.runflow/SC-.../..." } (current)
 *
 * The regex is deliberately permissive: any token matching /SC-[A-Za-z0-9-]+/
 * in the value's stringification counts.
 */
export function extractScenarioIds(ref: unknown): string[] {
  if (typeof ref === "string") {
    const m = ref.match(/SC-[A-Za-z0-9-]+/g);
    return m ?? [ref];
  }
  if (ref && typeof ref === "object") {
    const r = ref as Record<string, unknown>;
    if (typeof r["scenario_id"] === "string") return [r["scenario_id"]];
    if (Array.isArray(r["scenarios"])) return (r["scenarios"] as unknown[]).map(String);
    const path = typeof r["path"] === "string" ? r["path"] : "";
    const label = typeof r["label"] === "string" ? r["label"] : "";
    const blob = `${path} ${label}`;
    const matches = blob.match(/SC-[A-Za-z0-9-]+/g);
    if (matches) return matches;
  }
  return [];
}

function citeKey(c: Record<string, unknown>): string {
  if (c["kind"] === "code") return `code:${String(c["file"] ?? "")}`;
  if (c["kind"] === "doc") return `doc:${String(c["doc_path"] ?? "")}`;
  return "";
}

function citeLineRange(c: Record<string, unknown>): [number, number] | null {
  const ls = c["line_start"];
  const le = c["line_end"];
  if (typeof ls === "number" && typeof le === "number") return [ls, le];
  return null;
}

/** Same file/doc + overlapping line ranges (for code cites). */
export function citesLinked(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ka = citeKey(a);
  const kb = citeKey(b);
  if (!ka || ka !== kb) return false;
  if (a["kind"] === "code") {
    const ra = citeLineRange(a);
    const rb = citeLineRange(b);
    if (!ra || !rb) return true; // file-level match if one side lacks lines
    return ra[0] <= rb[1] && rb[0] <= ra[1];
  }
  return true;
}

/** Per-scenario status. */
export function buildScenarioStatusMap(inputs: SiteInputs): Map<string, CoverStatus> {
  const out = new Map<string, CoverStatus>();
  for (const p of inputs.plans) {
    const status = planStatusToCut(p["status"]);
    const flows = Array.isArray(p["target_test_flow_ids"])
      ? (p["target_test_flow_ids"] as unknown[]).map(String)
      : [];
    for (const f of flows) if (!out.has(f)) out.set(f, status);
  }
  for (const f of inputs.findings) {
    if (f["kind"] !== "bug") continue;
    const refs = Array.isArray(f["evidence_refs"]) ? (f["evidence_refs"] as unknown[]) : [];
    for (const r of refs) for (const sid of extractScenarioIds(r)) out.set(sid, "bug");
  }
  return out;
}

/** Per-decision status, joining via evidence_scenario_ids (preferred) then
 *  falling back to code-cite overlap with every scenario. */
export function buildDecisionStatusMap(inputs: SiteInputs): Map<string, CoverStatus> {
  const scenStatus = buildScenarioStatusMap(inputs);
  const out = new Map<string, CoverStatus>();
  for (const d of inputs.decisions) {
    const id = String(d["id"] ?? "");
    let acc: CoverStatus | null = null;
    const explicit = Array.isArray(d["evidence_scenario_ids"])
      ? (d["evidence_scenario_ids"] as unknown[]).map(String)
      : [];
    for (const sid of explicit) {
      const s = scenStatus.get(sid);
      if (s) acc = mergeStatus(acc, s);
    }
    if (acc === null) {
      const dCites = Array.isArray(d["cites"]) ? (d["cites"] as Array<Record<string, unknown>>) : [];
      for (const sc of inputs.scenarios) {
        const scId = String(sc["id"] ?? "");
        const scCites = Array.isArray(sc["cites"]) ? (sc["cites"] as Array<Record<string, unknown>>) : [];
        const linked = dCites.some((dc) => scCites.some((sCite) => citesLinked(dc, sCite)));
        if (linked) {
          const s = scenStatus.get(scId);
          if (s) acc = mergeStatus(acc, s);
        }
      }
    }
    out.set(id, acc ?? "gap");
  }
  return out;
}

// ── GROUNDED path — per-item status from the per-goal verdict map ────────────
//
// The body's execution truth. Each item's status is derived ONLY from
// `adjudicated.flowStatus` (the SAME source the headline aggregates use),
// joined item → flow(s). The synth `plan.status` maps above stay available for
// the labeled, SUBORDINATE "design-intent" view only — never the result.

/** Read the per-goal adjudicated status map; `undefined` when the host omits it
 *  (older contract). Defensive — the runtime object carries it when emitted. */
export function readFlowStatus(
  inputs: SiteInputs,
): Record<string, AdjudicatedFlowStatus> | undefined {
  return readAdjudicated(inputs)?.flowStatus;
}

/** The 5-cut: a per-goal verdict status → a body CoverStatus. */
export function flowStatusToCut(s: AdjudicatedFlowStatus): CoverStatus {
  switch (s) {
    case "satisfied":
      return "ok"; // Coberto
    case "violated":
      return "failed"; // Falhou
    case "blocked":
      return "blocked"; // Bloqueado
    case "contradictory":
      return "contradictory"; // integrity note (não-é-bug)
    case "not_adjudicated":
      return "gap"; // Não executado (mappable, no adjudicating verdict)
    default:
      return "unmapped";
  }
}

/** One flow id → its grounded cut.
 *   - no ref (empty id)               → unmapped (no flow to join)
 *   - map absent entirely (no source) → gap      (não executado; not loud-gap)
 *   - map present but flow absent     → unmapped (SEM MAPEAMENTO — the loud gap)
 */
function lookupFlowCut(
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
  flowId: string,
): CoverStatus {
  if (flowId === "") return "unmapped";
  if (!flowStatus) return "gap";
  const s = flowStatus[flowId];
  if (s === undefined) return "unmapped";
  return flowStatusToCut(s);
}

/** Aggregate the resolved cuts for an item joined to ≥1 flow:
 *   - no resolved cut → unmapped (SEM MAPEAMENTO)
 *   - one distinct    → that cut
 *   - conflicting     → misto (NEVER a fabricated single status)
 */
function aggregateGrounded(cuts: CoverStatus[]): CoverStatus {
  if (cuts.length === 0) return "unmapped";
  const distinct = new Set(cuts);
  if (distinct.size === 1) return [...distinct][0]!;
  return "misto";
}

/** scenario.flow_id → flowStatus. Absent/unknown flow id → SEM MAPEAMENTO. */
export function buildGroundedScenarioStatusMap(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): Map<string, CoverStatus> {
  const out = new Map<string, CoverStatus>();
  for (const sc of inputs.scenarios) {
    const id = String(sc["id"] ?? "");
    const flowId = sc["flow_id"] != null ? String(sc["flow_id"]) : "";
    out.set(id, lookupFlowCut(flowStatus, flowId));
  }
  return out;
}

/** plan.flow_ids (authoritative) → aggregate. `target_test_flow_ids` are
 *  ScenarioBlock ids, NOT flow ids — deliberately NOT used here. */
export function buildGroundedPlanStatusMap(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): Map<string, CoverStatus> {
  const out = new Map<string, CoverStatus>();
  for (const p of inputs.plans) {
    const id = String(p["id"] ?? "");
    const flowIds = Array.isArray(p["flow_ids"])
      ? (p["flow_ids"] as unknown[]).map(String)
      : [];
    if (flowIds.length === 0) {
      out.set(id, "unmapped");
      continue;
    }
    out.set(id, aggregateGrounded(flowIds.map((f) => lookupFlowCut(flowStatus, f))));
  }
  return out;
}

/** Linked scenario ids for a decision — the EXISTING coverage linking reused:
 *  `evidence_scenario_ids` preferred, else code-cite overlap. */
export function linkedScenarioIds(
  d: Record<string, unknown>,
  inputs: SiteInputs,
): string[] {
  const explicit = Array.isArray(d["evidence_scenario_ids"])
    ? (d["evidence_scenario_ids"] as unknown[]).map(String)
    : [];
  if (explicit.length) return explicit;
  const out: string[] = [];
  const dCites = Array.isArray(d["cites"]) ? (d["cites"] as Array<Record<string, unknown>>) : [];
  for (const sc of inputs.scenarios) {
    const scCites = Array.isArray(sc["cites"]) ? (sc["cites"] as Array<Record<string, unknown>>) : [];
    if (dCites.some((dc) => scCites.some((s) => citesLinked(dc, s)))) {
      out.push(String(sc["id"] ?? ""));
    }
  }
  return out;
}

/** TRANSITIVE: decision → linked scenario(s) → scenario.flow_id → flowStatus.
 *  Resolves to ONE flow / consistent set → that status; conflicting → misto; no
 *  clean path → SEM MAPEAMENTO. */
export function buildGroundedDecisionStatusMap(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): Map<string, CoverStatus> {
  const scenFlowId = new Map<string, string>();
  for (const sc of inputs.scenarios) {
    const id = String(sc["id"] ?? "");
    const f = sc["flow_id"] != null ? String(sc["flow_id"]) : "";
    if (f) scenFlowId.set(id, f);
  }
  const out = new Map<string, CoverStatus>();
  for (const d of inputs.decisions) {
    const id = String(d["id"] ?? "");
    const cuts: CoverStatus[] = [];
    for (const sid of linkedScenarioIds(d, inputs)) {
      const f = scenFlowId.get(sid);
      if (f) cuts.push(lookupFlowCut(flowStatus, f));
    }
    out.set(id, aggregateGrounded(cuts));
  }
  return out;
}

/** TRANSITIVE: AC → decision.cites[].ac_id → grounded decision status. Decisions
 *  that resolve to no flow (unmapped) contribute nothing unless ALL do. */
export function buildGroundedAcStatusMap(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): Map<string, CoverStatus> {
  const decStatus = buildGroundedDecisionStatusMap(inputs, flowStatus);
  const byAc = new Map<string, CoverStatus[]>();
  for (const d of inputs.decisions) {
    const did = String(d["id"] ?? "");
    const dCut = decStatus.get(did) ?? "unmapped";
    const cites = Array.isArray(d["cites"]) ? (d["cites"] as Array<Record<string, unknown>>) : [];
    for (const c of cites) {
      const acId = String(c["ac_id"] ?? "");
      if (!acId) continue;
      const arr = byAc.get(acId) ?? [];
      arr.push(dCut);
      byAc.set(acId, arr);
    }
  }
  const out = new Map<string, CoverStatus>();
  for (const [ac, cuts] of byAc) {
    const mapped = cuts.filter((c) => c !== "unmapped");
    out.set(ac, mapped.length ? aggregateGrounded(mapped) : "unmapped");
  }
  return out;
}

/** Per-AC status, joining via decision.cites[].ac_id. */
export function buildAcStatusMap(inputs: SiteInputs): Map<string, CoverStatus> {
  const decStatus = buildDecisionStatusMap(inputs);
  const out = new Map<string, CoverStatus>();
  for (const d of inputs.decisions) {
    const did = String(d["id"] ?? "");
    const dStatus = decStatus.get(did) ?? "gap";
    const cites = Array.isArray(d["cites"]) ? (d["cites"] as Array<Record<string, unknown>>) : [];
    for (const c of cites) {
      const acId = String(c["ac_id"] ?? "");
      if (!acId) continue;
      out.set(acId, mergeStatus(out.get(acId) ?? null, dStatus));
    }
  }
  return out;
}
