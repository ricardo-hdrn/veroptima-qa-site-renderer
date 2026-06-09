/**
 * veroptima-qa-site-renderer — HTML site renderer for qa-expert.
 *
 * Implements `@qa-expert/renderer-adapter-contract` v0.1.0.
 *
 * Consumes a `SiteInputs` (already loaded from disk by the host) and emits
 * `SiteOutput` (HTML bytes + files-to-copy plan). Stateless and deterministic:
 * same inputs → byte-identical bytes. The host owns the output directory and
 * file copying.
 */
import { z } from "zod";
import {
  defineRendererAdapter,
  type PluginContext,
  type RendererAdapter,
  type RendererHealth,
  type SiteInputs,
  type SiteOutput,
} from "@qa-expert/renderer-adapter-contract";

import { renderSite as renderSiteCore } from "./render.js";

// ── Config ─────────────────────────────────────────────────────────────────────

/** Plugin config — currently locale-only; v1 supports pt-BR exclusively. */
export const SiteRendererConfigSchema = z
  .object({
    locale: z.enum(["pt-BR"]).default("pt-BR"),
  })
  .strict();
export type SiteRendererConfig = z.infer<typeof SiteRendererConfigSchema>;

// ── Adapter ────────────────────────────────────────────────────────────────────

class SiteRendererAdapter implements RendererAdapter {
  constructor(
    private readonly config: SiteRendererConfig,
    private readonly ctx: PluginContext,
  ) {}

  async init(): Promise<void> {
    // No external resources to validate — the CSS + brand assets ship inside
    // the plugin package. healthCheck() will surface if anything's missing.
    this.ctx.logger.info("veroptima-qa-site-renderer initialized", {
      locale: this.config.locale,
    });
  }

  async renderSite(inputs: SiteInputs): Promise<SiteOutput> {
    return renderSiteCore(inputs);
  }

  async healthCheck(): Promise<RendererHealth> {
    return {
      ok: true,
      name: "veroptima-qa-site-renderer",
      locale: this.config.locale,
    };
  }
}

// ── Factory (default export) ───────────────────────────────────────────────────

export default defineRendererAdapter<SiteRendererConfig>({
  subkind: "site",
  contractVersion: "0.1.0",
  configSchema: SiteRendererConfigSchema,
  create: (config, ctx) => new SiteRendererAdapter(config, ctx),
});
