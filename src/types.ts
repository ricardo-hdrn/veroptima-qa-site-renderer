/**
 * Re-export the contract types so internal modules import from one place.
 * The contract is the source of truth for SiteInputs/SiteOutput shapes.
 */
export type {
  EvidenceDir,
  FeatureManifest,
  FileToCopy,
  SiteInputs,
  SiteInputsSource,
  SiteOutput,
} from "@qa-expert/renderer-adapter-contract";

import type { SiteInputs } from "@qa-expert/renderer-adapter-contract";

/** Checkpoint inputs surfaced into §08; lifted from SiteInputs for sections. */
export type CheckpointInputs = SiteInputs["checkpoints"];

/**
 * GROUNDED per-feature adjudicated KPIs — the RESULT, computed upstream from
 * runs.db verdict rows + flows.json membership (deterministic). The host
 * (qa-expert) emits this on `inputs.adjudicated` for the single feature this
 * SiteInputs renders.
 *
 * NOTE (contract-type linking): the installed/linked
 * `@qa-expert/renderer-adapter-contract` (`SiteInputsSchema` is `.strict()`)
 * does NOT yet carry the optional `adjudicated` field in its TYPES — that
 * change is unpushed in the qa-expert worktree. We therefore mirror the host's
 * `SiteAdjudicatedKpis` shape LOCALLY and read `inputs.adjudicated` defensively
 * through `AdjudicatedSiteInputs`. The runtime object DOES carry it (the host
 * always emits it).
 */
/**
 * Per-goal adjudicated status (the per-ITEM grain of the headline rollup).
 * flowId == Flow.id == goalId. Emitted by the host on `adjudicated.flowStatus`
 * from the SAME deriveFeatureRollups join the headline aggregates use, so the
 * per-flow map reconciles to the per-feature numbers by construction.
 *   - satisfied        → a satisfied verdict          (Coberto)
 *   - violated         → a violated verdict           (Falhou)
 *   - blocked          → proven_blocked               (Bloqueado)
 *   - contradictory    → contradictory/flip goal      (integrity note, NOT bug)
 *   - not_adjudicated  → discovered flow, rows-but-inconclusive OR no rows
 *                        (the MAPPABLE Não executado — legit, not a gap)
 *   - excluded         → a discovered flow in the feature's addressable
 *                        exclusions (manifest addressable_exclusions, e.g. a
 *                        GEO mock/no-backend flow) — OUT OF SCOPE by policy.
 *                        Takes precedence over not_adjudicated. It is NOT
 *                        addressable: it sits OUTSIDE the addressable
 *                        completude/conformidade denominators, and must NEVER
 *                        be rendered as the mappable "Não executado" gap.
 */
export type AdjudicatedFlowStatus =
  | "satisfied"
  | "violated"
  | "contradictory"
  | "blocked"
  | "not_adjudicated"
  | "excluded";

export interface SiteAdjudicatedKpis {
  /** true => no verdict source: render an honest gap, NEVER 0/100. */
  noAdjudicatedData: boolean;
  /** COMPLETUDE = verified/addressable. */
  completude: { verified: number; addressable: number; pct: number };
  /** CONFORMIDADE = approved/addressable (approved = satisfied-and-not-violated). */
  conformidade: { approved: number; addressable: number; pct: number };
  /** Adjudicated app-defects — the RESULT bug count. */
  bugsApp: { count: number; flows: string[] };
  /** Contradictory/flip goals — integrity note, NOT a bug. */
  verdictIntegrity: { count: number; flows: string[] };
  /**
   * Per-goal adjudicated status map (`flowId → status`). The SINGLE SOURCE for
   * the report BODY (heatmap / cases / decisions / plans), consistent with the
   * headline by construction. Optional: an older host may omit it — read
   * defensively. NOT the pass/incomplete/fail FlowVerdict (a different vocab).
   */
  flowStatus?: Record<string, AdjudicatedFlowStatus>;
}

/** SiteInputs widened with the (host-emitted) optional grounded KPIs. */
export type AdjudicatedSiteInputs = SiteInputs & {
  adjudicated?: SiteAdjudicatedKpis;
};

/**
 * Defensive reader: the contract type omits `adjudicated`, so pull it off the
 * runtime object through the widened type. Returns `undefined` when absent.
 */
export function readAdjudicated(inputs: SiteInputs): SiteAdjudicatedKpis | undefined {
  return (inputs as AdjudicatedSiteInputs).adjudicated;
}
