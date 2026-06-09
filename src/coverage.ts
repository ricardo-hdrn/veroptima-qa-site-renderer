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
import type { SiteInputs } from "./types.js";

export type CoverStatus = "ok" | "partial" | "blocked" | "gap" | "bug";

const STATUS_RANK: Record<CoverStatus, number> = {
  ok: 4,
  partial: 3,
  blocked: 2,
  gap: 1,
  bug: 0,
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
