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
import type { SiteInputs } from "../types.js";

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
  return `
<main>
  <div class="stats wrap">
    <div class="stat green">
      <div class="v">${k.completudePct}%</div>
      <div class="l">Completude — decisões exercitadas (${k.totalDecisions ? `de ${k.totalDecisions}` : "sem decisões"})</div>
    </div>
    <div class="stat">
      <div class="v">${k.conformidadePct}%</div>
      <div class="l">Conformidade — decisões sem bug</div>
    </div>
    <div class="stat red">
      <div class="v">${k.bugs}${k.poQuestions ? `<small> +${k.poQuestions}</small>` : ""}</div>
      <div class="l">${k.bugs === 1 ? "bug" : "bugs"}${k.poQuestions ? ` + ${k.poQuestions} ${k.poQuestions === 1 ? "questão PM/PO" : "questões PM/PO"}` : ""}</div>
    </div>
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
