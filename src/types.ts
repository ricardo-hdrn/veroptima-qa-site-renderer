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
