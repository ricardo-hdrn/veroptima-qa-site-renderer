/**
 * Main HTML assembly. Deterministic: any timestamp comes from
 * `inputs.builtAtIso` (caller-supplied). Never reads `Date.now()` or
 * `Math.random()`. Same inputs → byte-identical HTML.
 *
 * Bundles the embedded CSS verbatim from `./css/site.css` (vendored from
 * the gold reference) so the output is self-contained: no external CSS
 * requests, no Google Fonts — the v1 gold reference's font-face links
 * are stripped in favor of system fonts.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esc } from "./escape.js";
import { renderCases, renderCasesScript } from "./sections/cases.js";
import { renderCompletude, renderGaugeScript } from "./sections/completude.js";
import { renderDecisions, renderDecisionsScript } from "./sections/decisions.js";
import { renderExecution } from "./sections/execution.js";
import { renderFeatureSpec } from "./sections/feature-spec.js";
import { renderFindings } from "./sections/findings.js";
import { renderObjectives } from "./sections/objectives.js";
import { renderStats } from "./sections/stats.js";
import { renderTabNav, renderTabScript } from "./sections/tabs.js";
import { renderWhatDoes } from "./sections/what-does.js";
import type { SiteInputs, SiteOutput } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, "css", "site.css");
const ASSETS_DIR = join(HERE, "assets", "brand");
const FONTS_DIR = join(HERE, "assets", "fonts");
const BRAND_FILES = [
  "favicon.svg",
  "icon-app.svg",
  "logo-mono.svg",
  "logo.svg",
  "mark-mono.svg",
  "mark.svg",
  "wordmark.svg",
];
const FONT_FILES = ["Audiowide-Regular.woff2"];

async function loadCss(): Promise<string> {
  return readFile(CSS_PATH, "utf8");
}

function renderHead(inputs: SiteInputs, css: string): string {
  return `<!DOCTYPE html>
<html lang="${esc(inputs.locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(inputs.feature.name)}</title>
<link rel="icon" type="image/svg+xml" href="assets/brand/favicon.svg" />
<style>
${css}
</style>
</head>`;
}

function renderCover(inputs: SiteInputs): string {
  const evCount = inputs.evidenceDirs.length;
  return `
<div class="topbar">
  <div class="wrap">
    <img class="mark" src="assets/brand/mark.svg" alt="" />
    <span class="wordmark-txt"><span class="v">ver</span><span class="o">optima</span></span>
  </div>
</div>

<header class="hero">
  <div class="wrap">
    <h1>${esc(inputs.feature.name)}</h1>
    <div class="chips">
      <span class="chip">Feature&nbsp;<b>${esc(inputs.feature.id)}</b></span>
      <span class="chip">Planos&nbsp;<b>${inputs.plans.length}</b></span>
      <span class="chip">Decisões&nbsp;<b>${inputs.decisions.length}</b></span>
      <span class="chip">Findings&nbsp;<b>${inputs.findings.length}</b></span>
      <span class="chip">Evidências&nbsp;<b>${evCount}</b></span>
      <span class="chip">Gerado&nbsp;<b>${esc(inputs.builtAtIso)}</b></span>
    </div>
  </div>
</header>`;
}

function renderFooter(inputs: SiteInputs): string {
  return `
<footer class="site-footer">
  <p class="faint">
    Fonte: <code class="mono">${esc(inputs.source.sessionDir)}</code><br/>
    Capability: <code>${esc(inputs.source.capabilityId)}</code><br/>
    Gerado pelo renderer
    <code>@qa-expert/site-renderer</code> · v1
  </p>
</footer>`;
}

const HTML_CLOSE = `
</body>
</html>`;

/**
 * Embed/fragment mode — section content only (no doc chrome / hero / footer / scripts), with the
 * stylesheet returned separately so a host can scope it (Shadow DOM) and remap the color vars to its
 * own design tokens. Powers the dynamic, console-themed feature view (no iframe).
 */
export async function renderFragment(
  inputs: SiteInputs,
): Promise<{ html: string; css: string; scripts: string[] }> {
  const css = await loadCss();
  const html =
    renderTabNav() +
    "\n" +
    renderStats(inputs) +
    "\n<main>\n" +
    [
      renderCompletude(inputs),
      renderWhatDoes(inputs),
      renderFeatureSpec(inputs),
      renderObjectives(inputs),
      renderCases(inputs),
      renderDecisions(inputs),
      renderFindings(inputs),
      renderExecution(inputs),
    ].join("\n") +
    "\n</main>";
  // Script bodies (no <script> tags) — the host runs these with `document` rebound to the embed root,
  // since the renderer's scripts target `document` and can't reach into a Shadow DOM.
  const strip = (s: string) => s.replace(/<\/?script[^>]*>/g, "");
  const scripts = [renderTabScript(), renderGaugeScript(), renderCasesScript(), renderDecisionsScript()].map(strip);
  return { html, css, scripts };
}

export async function renderSite(inputs: SiteInputs): Promise<SiteOutput> {
  const css = await loadCss();
  const sectionsMain =
    "<main>\n" +
    [
      renderCompletude(inputs),
      renderWhatDoes(inputs),
      renderFeatureSpec(inputs),
      renderObjectives(inputs),
      renderCases(inputs),
      renderDecisions(inputs),
      renderFindings(inputs),
      renderExecution(inputs),
    ].join("\n") +
    "\n" +
    renderFooter(inputs) +
    "\n</main>";

  const html = `${renderHead(inputs, css)}
<body>
${renderCover(inputs)}
${renderStats(inputs)}
${renderTabNav()}
${sectionsMain}
${renderTabScript()}
${renderGaugeScript()}
${renderCasesScript()}
${renderDecisionsScript()}
${HTML_CLOSE}`;

  // Files to copy: brand assets + font (when vendored) + evidence dirs +
  // runflow bundle. The font may be absent — buildSite() resolves that
  // via existsSync before copying.
  const filesToCopy = [
    ...BRAND_FILES.map((f) => ({
      src: join(ASSETS_DIR, f),
      dst: join("assets", "brand", f),
    })),
    ...FONT_FILES.map((f) => ({
      src: join(FONTS_DIR, f),
      dst: join("assets", "fonts", f),
      optional: true as const,
    })),
    ...inputs.evidenceDirs.map((ev) => ({
      src: ev.absPath,
      dst: join("evidence", ev.scenario),
    })),
    ...(inputs.runflowDir
      ? [{ src: inputs.runflowDir, dst: "runflow" }]
      : []),
  ];

  const manifest = {
    generated_by: "@qa-expert/site-renderer",
    schema_version: 1,
    feature: inputs.feature,
    source: inputs.source,
    built_at: inputs.builtAtIso,
    counts: {
      specs: inputs.specs.length,
      stories_acs: inputs.storiesAcs.length,
      decisions: inputs.decisions.length,
      scenarios: inputs.scenarios.length,
      plans: inputs.plans.length,
      findings: inputs.findings.length,
      evidence_dirs: inputs.evidenceDirs.length,
    },
    runflow_bundled: inputs.runflowDir !== null,
  };

  return { html, filesToCopy, manifest };
}
