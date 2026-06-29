/**
 * Hero KPI stats row — 5 cards (`.stat` with semantic color variants).
 * Sits between <header class="hero"> and the tab nav, in its own <main>
 * block, mirroring the gold reference's structure.
 *
 * Decisions are the unit (consistent with the §Completude gauges + the
 * §Cobertura Detalhada table); reuses the shared `buildDecisionStatusMap`.
 */
import { buildDecisionStatusMap } from "../coverage.js";
import { esc } from "../escape.js";
import { readAdjudicated, type SiteInputs } from "../types.js";

function computeKpis(inputs: SiteInputs) {
  const totalDecisions = inputs.decisions.length;
  const blocked = inputs.plans.filter((p) => p["status"] === "blocked").length;
  const bugs = inputs.findings.filter((f) => f["kind"] === "bug").length;
  const drifts = inputs.findings.filter((f) => f["kind"] === "spec_drift").length;
  const poQuestions = inputs.findings.filter((f) => f["kind"] === "po_question").length;

  let decisionsOk = 0;
  let decisionsPartial = 0;
  let decisionsBug = 0;
  if (totalDecisions > 0) {
    const decStatus = buildDecisionStatusMap(inputs);
    for (const status of decStatus.values()) {
      if (status === "ok") decisionsOk++;
      else if (status === "partial") decisionsPartial++;
      else if (status === "bug") decisionsBug++;
    }
  }
  const completudePct =
    totalDecisions === 0
      ? 0
      : Math.round(((decisionsOk + 0.5 * decisionsPartial) / totalDecisions) * 100);
  const conformidadePct =
    totalDecisions === 0
      ? 0
      : Math.round(((totalDecisions - decisionsBug) / totalDecisions) * 100);

  return {
    completudePct,
    conformidadePct,
    bugs,
    drifts,
    poQuestions,
    blocked,
    scriptsCount: inputs.scenarios.length,
    totalDecisions,
  };
}

export function renderStats(inputs: SiteInputs): string {
  const k = computeKpis(inputs);
  const adj = readAdjudicated(inputs);
  const grounded = adj && !adj.noAdjudicatedData ? adj : undefined;

  // HEADLINE KPI cards. The result comes from the GROUNDED adjudicated verdicts
  // when present. When there is no verdict source we render an honest gap ("—")
  // — NEVER the synth-derived 0%/100% as the headline result. The synth-derived
  // numbers are demoted into the labeled "Síntese" section in §Completude.
  // Round ONCE for display (Math.round — same rule as the monitor/cockpit/TUI).
  // The single rounded value is the only number rendered; no raw float reaches
  // the visible text.
  const groundedComplPct = grounded ? Math.round(grounded.completude.pct) : 0;
  const groundedConfPct = grounded ? Math.round(grounded.conformidade.pct) : 0;
  const resultCards = grounded
    ? `
    <div class="stat green">
      <div class="v">${groundedComplPct}%</div>
      <div class="l">Completude — verificados/endereçáveis (adjudicado: ${grounded.completude.verified}/${grounded.completude.addressable})</div>
    </div>
    <div class="stat">
      <div class="v">${groundedConfPct}%</div>
      <div class="l">Conformidade — aprovados/endereçáveis (adjudicado: ${grounded.conformidade.approved}/${grounded.conformidade.addressable})</div>
    </div>
    <div class="stat red">
      <div class="v">${grounded.bugsApp.count}</div>
      <div class="l">${grounded.bugsApp.count === 1 ? "bug de aplicação" : "bugs de aplicação"} (adjudicado)</div>
    </div>`
    : `
    <div class="stat">
      <div class="v">—</div>
      <div class="l">Completude — sem veredito adjudicado</div>
    </div>
    <div class="stat">
      <div class="v">—</div>
      <div class="l">Conformidade — sem veredito adjudicado</div>
    </div>
    <div class="stat">
      <div class="v">${k.bugs}</div>
      <div class="l">achados brutos (raw findings, kind=bug) — não adjudicado</div>
    </div>`;
  return `
<main>
  <div class="stats wrap">
    ${resultCards}
    <div class="stat amber">
      <div class="v">${k.blocked}</div>
      <div class="l">planos bloqueados${k.drifts ? ` · ${k.drifts} spec-drift` : ""}</div>
    </div>
    <div class="stat blue">
      <div class="v">${k.scriptsCount}</div>
      <div class="l">cenários</div>
    </div>
  </div>
</main>`;
}
