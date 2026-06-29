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
