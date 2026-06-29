/**
 * §04 Casos de teste, planos & evidências — renders scenarios grouped by
 * parent plan as `<details class="sc">` collapsibles, with filter buttons,
 * scenario detail dl (Intenção / AC-regra / Passos / Previsto / Resultado /
 * Citação), and the VERDICT-ANCHORED evidence DRILL: the scenario's flow →
 * its proving run → ordered steps → step-anchored screenshots (see drill.ts).
 * This replaces the old flat per-scenario carousel, which keyed evidenceDirs
 * by scenario id and so rendered 0 slides (evidenceDir.scenario === runId).
 *
 * Status mapping (5-status palette, derived from parent plan status):
 *   ticked  → ok       (✓ Conforme)
 *   split   → partial  (◑ Parcial)
 *   blocked → blocked  (🔒 Bloqueado)
 *   pending → gap      (⬜ Não exec.)
 *   bug-found (finding referencing scenario) → bug
 */
import {
  buildGroundedScenarioStatusMap,
  COVER_CLASS,
  COVER_LABEL,
  type CoverStatus,
  readFlowStatus,
} from "../coverage.js";
import { renderFlowDrill } from "../drill.js";
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

type CaseStatus = CoverStatus;

// Visible label + pill class are single-sourced from the coverage module, so
// the human text and the machine `data-v` can never diverge.
const VLABEL = COVER_LABEL;
const VCLASS = COVER_CLASS;

/** Find the parent plan for a scenario id and derive its case status via
 *  the shared scenario-status map (consistent with §Painel + §Cobertura). */
function deriveStatus(
  scenarioId: string,
  inputs: SiteInputs,
  scenStatus: Map<string, CoverStatus>,
): { status: CaseStatus; planId: string | null; planName: string | null } {
  const status = scenStatus.get(scenarioId) ?? "gap";
  for (const p of inputs.plans) {
    const flows = Array.isArray(p["target_test_flow_ids"])
      ? (p["target_test_flow_ids"] as unknown[]).map(String)
      : [];
    if (flows.includes(scenarioId)) {
      return {
        status,
        planId: String(p["id"] ?? ""),
        planName: String(p["name"] ?? ""),
      };
    }
  }
  return { status, planId: null, planName: null };
}

function renderFirstCite(scenario: Record<string, unknown>): string {
  const cites = Array.isArray(scenario["cites"]) ? (scenario["cites"] as Array<Record<string, unknown>>) : [];
  if (cites.length === 0) return '<span class="faint">(sem citação)</span>';
  const c = cites[0]!;
  if (c["kind"] === "code") {
    const file = String(c["file"] ?? "");
    const ls = c["line_start"];
    const le = c["line_end"];
    const range = typeof ls === "number" && typeof le === "number" ? `:${ls}-${le}` : "";
    return `<span class="mono">${esc(file)}${range}</span>`;
  }
  if (c["kind"] === "doc") {
    return `<span class="mono">${esc(String(c["doc_path"] ?? ""))}</span>`;
  }
  return `<span class="mono">${esc(JSON.stringify(c))}</span>`;
}

function renderSteps(scenario: Record<string, unknown>): string {
  const steps = Array.isArray(scenario["steps"]) ? (scenario["steps"] as Array<Record<string, unknown>>) : [];
  if (steps.length === 0) return '<span class="faint">(sem passos persistidos)</span>';
  return (
    `<ol class="step-list">` +
    steps
      .map((s) => {
        const action = String(s["action"] ?? "?");
        const intent = s["intent"];
        const target = s["target"] ?? s["selector"] ?? s["url"];
        const value = s["value"] ?? s["text"];
        const intentStr = typeof intent === "object" && intent !== null ? JSON.stringify(intent) : String(intent ?? "");
        return `<li><b class="mono">${esc(action)}</b>${target ? ` <span class="mono faint">${esc(JSON.stringify(target))}</span>` : ""}${intentStr ? ` <span class="faint">${esc(intentStr)}</span>` : ""}${value !== undefined ? ` → <span class="mono">${esc(String(value))}</span>` : ""}</li>`;
      })
      .join("\n") +
    `</ol>`
  );
}

function renderScenario(
  scenario: Record<string, unknown>,
  inputs: SiteInputs,
  scenStatus: Map<string, CoverStatus>,
): string {
  const id = String(scenario["id"] ?? "?");
  const name = String(scenario["name"] ?? "");
  const intent = String(scenario["intent"] ?? "");
  const preconditions = String(scenario["preconditions"] ?? "");
  const expected = String(scenario["expected_verdict"] ?? "");
  const verification = String(scenario["verification"] ?? "");
  const flowId = scenario["flow_id"] != null ? String(scenario["flow_id"]) : "";
  const { status } = deriveStatus(id, inputs, scenStatus);

  return `
<details class="sc" data-v="${status}">
  <summary>
    <span class="scid">${esc(id)}</span>
    <span class="scname">${esc(name)}</span>
    <span class="flow"><span class="pill ${VCLASS[status]}">${esc(VLABEL[status])}</span></span>
    <span class="arr">▸</span>
  </summary>
  <div class="scbody">
    <dl>
      ${intent ? `<dt>Intenção</dt><dd>${esc(intent)}</dd>` : ""}
      ${preconditions ? `<dt>Pré-condições</dt><dd>${esc(preconditions)}</dd>` : ""}
      <dt>Passos</dt><dd>${renderSteps(scenario)}</dd>
      ${expected ? `<dt>Previsto</dt><dd><span class="pill ${VCLASS[status]}">${esc(expected)}</span></dd>` : ""}
      ${verification ? `<dt>Resultado</dt><dd>${esc(verification)}</dd>` : ""}
      <dt>Citação</dt><dd class="cite">${renderFirstCite(scenario)}</dd>
      ${renderFlowDrill(inputs, flowId)}
    </dl>
  </div>
</details>`;
}

function groupScenariosByPlan(
  inputs: SiteInputs,
  scenStatus: Map<string, CoverStatus>,
): Array<{ planName: string; planStatus: string; blockedReason: string; scenarios: Array<Record<string, unknown>> }> {
  const byPlan = new Map<
    string,
    { planName: string; planStatus: string; blockedReason: string; scenarios: Array<Record<string, unknown>> }
  >();
  const orphans: Array<Record<string, unknown>> = [];
  for (const sc of inputs.scenarios) {
    const id = String(sc["id"] ?? "");
    const { planName, planId } = deriveStatus(id, inputs, scenStatus);
    if (planId) {
      const plan = inputs.plans.find((p) => p["id"] === planId);
      const entry = byPlan.get(planId) ?? {
        planName: planName ?? planId,
        planStatus: String(plan?.["status"] ?? ""),
        blockedReason: String(plan?.["blocked_reason"] ?? plan?.["reason"] ?? ""),
        scenarios: [],
      };
      entry.scenarios.push(sc);
      byPlan.set(planId, entry);
    } else {
      orphans.push(sc);
    }
  }
  // Include blocked plans even when they have no scenarios — they still need
  // to surface their blocked_reason ("source_gap: ..." per acceptance §40).
  for (const p of inputs.plans) {
    if (p["status"] !== "blocked") continue;
    const id = String(p["id"] ?? "");
    if (byPlan.has(id)) continue;
    byPlan.set(id, {
      planName: String(p["name"] ?? id),
      planStatus: "blocked",
      blockedReason: String(p["blocked_reason"] ?? p["reason"] ?? ""),
      scenarios: [],
    });
  }
  const out = [...byPlan.values()];
  if (orphans.length) {
    out.push({ planName: "(sem plano)", planStatus: "", blockedReason: "", scenarios: orphans });
  }
  return out;
}

export function renderCases(inputs: SiteInputs): string {
  // GROUNDED: per-scenario status comes from the per-goal verdict map joined via
  // scenario.flow_id — NOT the synth plan.status. A scenario with no flow_id (or
  // a flow_id absent from the map) renders SEM MAPEAMENTO, never "Não executado".
  const scenStatus = buildGroundedScenarioStatusMap(inputs, readFlowStatus(inputs));
  const groups = groupScenariosByPlan(inputs, scenStatus);
  const filterBar = `
<div class="fbar" id="casefilters">
  <button class="fbtn active" data-f="all">Todos</button>
  <button class="fbtn" data-f="ok">✓ Coberto</button>
  <button class="fbtn" data-f="failed">✗ Falhou</button>
  <button class="fbtn" data-f="gap">⬜ Não executado</button>
  <button class="fbtn" data-f="blocked">🔒 Bloqueado</button>
  <button class="fbtn" data-f="unmapped">❔ Sem mapeamento</button>
  <button class="fbtn" data-f="excluded">∅ Excluído</button>
</div>`;
  const body =
    groups.length === 0
      ? '<p class="faint">(sem cenários)</p>'
      : groups
          .map((g) => {
            const blockedBanner =
              g.planStatus === "blocked" && g.blockedReason
                ? `<div class="banner banner-blocked"><b>🔒 Plano bloqueado:</b> ${esc(g.blockedReason)}</div>`
                : "";
            const emptyHint =
              g.scenarios.length === 0
                ? '<p class="faint">(nenhum cenário pôde rodar — ver bloqueio acima)</p>'
                : "";
            return `
<div class="cgroup">
  <h3>${esc(g.planName)} <span class="cnt">${g.scenarios.length}</span></h3>
  ${blockedBanner}
  ${emptyHint}
  ${g.scenarios.map((s) => renderScenario(s, inputs, scenStatus)).join("\n")}
</div>`;
          })
          .join("\n");

  return `
<section id="casos" data-tab="casos">
  <h2><span class="num">04</span>Casos de teste, planos &amp; evidências</h2>
  ${filterBar}
  <div id="sc-root">${body}</div>
</section>`;
}

export function renderCasesScript(): string {
  return `
<script>
(function(){
  /* filter buttons in §Casos */
  const root = document.getElementById('sc-root');
  const bar  = document.getElementById('casefilters');
  if (bar) bar.addEventListener('click', (e)=>{
    const b = e.target.closest('.fbtn'); if (!b) return;
    bar.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const f = b.dataset.f;
    root.querySelectorAll('details.sc').forEach(d=>{
      d.classList.toggle('hidden', !(f==='all' || d.dataset.v===f));
    });
    root.querySelectorAll('.cgroup').forEach(g=>{
      const any = [...g.querySelectorAll('details.sc')].some(d=>!d.classList.contains('hidden'));
      g.classList.toggle('hidden', !any);
    });
  });
})();
</script>`;
}
