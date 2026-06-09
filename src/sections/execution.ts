/**
 * §08 Método — purely data-driven. The renderer surfaces only the fields
 * that actually exist on each checkpoint JSON (stage / closed_at / passed /
 * source_gap / ...). Stage titles + descriptions are NOT invented; if the
 * checkpoint payload lacks a human label, only the field values render.
 *
 * Cost-accounting (QA·mês) is omitted entirely unless a cost artifact lands
 * in the FeatureSet — the renderer prints "(sem dados de custo)" instead of
 * inventing prose.
 */
import { esc } from "../escape.js";
import type { CheckpointInputs, SiteInputs } from "../types.js";

function renderField(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    return `<dt>${esc(label)}</dt><dd class="mono">${esc(value)}</dd>`;
  }
  if (typeof value === "boolean") {
    return `<dt>${esc(label)}</dt><dd>${value ? "✓" : "✗"}</dd>`;
  }
  if (typeof value === "number") {
    return `<dt>${esc(label)}</dt><dd class="mono">${value}</dd>`;
  }
  // object / array — JSON.stringify with indentation
  return `<dt>${esc(label)}</dt><dd><pre class="cp-json">${esc(JSON.stringify(value, null, 2))}</pre></dd>`;
}

function renderCheckpoint(label: string, cp: Record<string, unknown> | null | undefined): string {
  if (!cp) {
    return `
<div class="tlrow tl-pending">
  <div class="tlhead">
    <span class="tltype"><span>${esc(label)}</span></span>
    <span class="tlstate">(não persistido)</span>
  </div>
</div>`;
  }
  // Surface only the keys actually present in the JSON.
  const entries = Object.entries(cp);
  const dlInner = entries
    .map(([k, v]) => renderField(k, v))
    .filter(Boolean)
    .join("");
  return `
<div class="tlrow">
  <div class="tlhead">
    <span class="tltype"><span>${esc(label)}</span></span>
  </div>
  <dl class="cp-dl">${dlInner}</dl>
</div>`;
}

function renderTimeline(cps: CheckpointInputs): string {
  return `
<div class="tl">
  ${renderCheckpoint("Checkpoint A", cps.A)}
  ${renderCheckpoint("Checkpoint B", cps.B)}
  ${renderCheckpoint("Checkpoint C", cps.C)}
</div>`;
}

export function renderExecution(inputs: SiteInputs): string {
  const evCount = inputs.evidenceDirs.length;
  const runflowLine = inputs.runflowDir
    ? `<a href="runflow/">runflow/ ↗</a>`
    : '<span class="faint">(sem bundle persistido)</span>';
  return `
<section id="metodo" data-tab="metodo">
  <h2><span class="num">08</span>Método</h2>
  <div class="card">
    <h3 style="margin-top:0">Checkpoints persistidos</h3>
    ${renderTimeline(inputs.checkpoints)}
  </div>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-top:0">Contagens</h3>
    <ul class="exec-tally">
      <li>specs: <b>${inputs.specs.length}</b> · stories/ACs: <b>${inputs.storiesAcs.length}</b> · decisões: <b>${inputs.decisions.length}</b></li>
      <li>cenários: <b>${inputs.scenarios.length}</b> · planos: <b>${inputs.plans.length}</b> · findings: <b>${inputs.findings.length}</b></li>
      <li>cenários com pasta de evidência: <b>${evCount}</b></li>
      <li>runflow bundle: ${runflowLine}</li>
    </ul>
  </div>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-top:0">Custo (QA·mês)</h3>
    <p class="faint">(sem artefato de custo persistido)</p>
  </div>
</section>`;
}
