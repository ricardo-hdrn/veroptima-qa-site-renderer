/**
 * §05b Resultados por fluxo — the PER-FLOW results surface that guarantees
 * EVERY adjudicated flow's status links to its proving run.
 *
 * WHY THIS EXISTS — the §Casos drill (`renderFlowDrill` invoked from cases.ts)
 * is keyed by `scenario.flow_id`, which is mostly unpopulated: busca has 8
 * adjudicated flows but only 2 §Casos scenarios carry a `flow_id`, so 6/8
 * adjudicated flows rendered NO drill — their status % had no drillable proof.
 *
 * THE FIX — iterate `adjudicated.flowStatus` directly, keyed by **flow.id**
 * (NOT scenario.flow_id), and render EVERY flow as a row carrying its STATUS
 * (the SAME `flowStatus` cut the body uses). For an ADJUDICATED flow
 * (satisfied / violated / contradictory) we REUSE `buildFlowDrill(flow.id, …)`
 * — the SAME deterministic proving-run rule, now selecting the run from
 * `adjudicated.flowProvingRuns` (the verdict-row source: satisfied→satisfiedRun,
 * violated→violatedRun, contradictory→BOTH; `data-proving-run` == verdict runId;
 * steps; screenshots; no fabrication). not_adjudicated / excluded / blocked /
 * unmapped show their status but NO drill (we never invent evidence).
 *
 * So coverage is COMPLETE for every adjudicated flow, independent of whether a
 * §Casos scenario references it. The §Casos scenario drill stays as additive.
 *
 * Each row carries `data-pf-flow` + `data-v`; the nested drill (present ONLY
 * for an adjudicated flow) carries `data-flow` + per-run `data-proving-run`.
 * `data-flow` is therefore the exclusive DRILL anchor — its presence means a
 * proving run exists — so the Part-3 completeness gate can assert
 * #adjudicated-drills == #adjudicated-flows directly off `data-flow`.
 */
import {
  COVER_CLASS,
  COVER_LABEL,
  flowStatusToCut,
  readFlowStatus,
} from "../coverage.js";
import { renderFlowDrill } from "../drill.js";
import { esc } from "../escape.js";
import type { AdjudicatedFlowStatus, SiteInputs } from "../types.js";

/** A flow is ADJUDICATED (and therefore drillable to a proving run) when its
 *  per-goal status is satisfied / violated / contradictory — the SAME set
 *  `buildFlowDrill` produces a proving run for. blocked / not_adjudicated /
 *  excluded → status shown, NO drill (no fabricated evidence). */
export function isAdjudicated(status: AdjudicatedFlowStatus): boolean {
  return status === "satisfied" || status === "violated" || status === "contradictory";
}

/** flow.id → human title, joined from `flowsWithVerdicts` (`title`/`name`,
 *  else the id). Single-sourced; never invented. */
function buildFlowNameMap(inputs: SiteInputs): Map<string, string> {
  const out = new Map<string, string>();
  for (const fwv of inputs.flowsWithVerdicts) {
    const flow = (fwv as Record<string, unknown>)["flow"];
    if (!flow || typeof flow !== "object") continue;
    const f = flow as Record<string, unknown>;
    const id = String(f["id"] ?? "");
    if (!id) continue;
    const name = String(f["title"] ?? f["name"] ?? id);
    out.set(id, name);
  }
  return out;
}

/** Render one flow row: id + name + status pill, and — for an adjudicated flow
 *  only — the inline proving-run drill (reusing `renderFlowDrill`). */
function renderFlowRow(
  inputs: SiteInputs,
  flowId: string,
  status: AdjudicatedFlowStatus,
  names: Map<string, string>,
): string {
  const cut = flowStatusToCut(status);
  const name = names.get(flowId) ?? flowId;
  const adjudicated = isAdjudicated(status);
  // REUSE the existing drill — same proving-run rule, same data-proving-run ==
  // verdict runId, same steps/screenshots. Only adjudicated flows get one.
  const drill = adjudicated ? renderFlowDrill(inputs, flowId) : "";
  const drillBlock = adjudicated
    ? drill
      ? `<dl class="pf-drill">${drill}</dl>`
      : // Adjudicated but no proving try on disk — honest, never fabricated.
        `<p class="pf-nodrill faint">(adjudicado, mas sem run comprovante registrado)</p>`
    : `<p class="pf-nodrill faint">(sem run comprovante — fluxo não adjudicado)</p>`;
  return `
<div class="pf-row" data-pf-flow="${esc(flowId)}" data-v="${esc(cut)}" data-flow-status="${esc(status)}">
  <div class="pf-h">
    <span class="pf-id mono">${esc(flowId)}</span>
    <span class="pf-name">${esc(name)}</span>
    <span class="pf-st"><span class="pill ${COVER_CLASS[cut]}">${esc(COVER_LABEL[cut])}</span></span>
  </div>
  ${drillBlock}
</div>`;
}

/**
 * §05b Resultados por fluxo — one row per adjudicated-flow entry in
 * `adjudicated.flowStatus`, each adjudicated flow drilling to its proving run.
 */
export function renderPerFlow(inputs: SiteInputs): string {
  const flowStatus = readFlowStatus(inputs);
  const entries = flowStatus ? Object.entries(flowStatus) : [];
  // Deterministic ordering — same inputs → byte-identical HTML.
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const names = buildFlowNameMap(inputs);

  const adjudicatedCount = entries.filter(([, s]) => isAdjudicated(s)).length;

  const body =
    entries.length === 0
      ? '<p class="faint">(sem mapa de veredito por fluxo — execução não adjudicada)</p>'
      : entries
          .map(([flowId, status]) => renderFlowRow(inputs, flowId, status, names))
          .join("\n");

  return `
<section id="resultados-fluxo" data-tab="casos">
  <h2><span class="num">05b</span>Resultados por fluxo <span class="faint">· cada status liga ao seu run comprovante</span></h2>
  <p class="pf-intro faint">Cada fluxo adjudicado (${adjudicatedCount}) abre o run que provou seu veredito: passou → run aprovado · falhou → run que provou o bug · contradição → ambos. Não-adjudicados mostram o status, sem evidência fabricada.</p>
  <div class="pf-root">${body}</div>
</section>`;
}
