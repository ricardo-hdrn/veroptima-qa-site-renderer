/**
 * §Completude e Cobertura — distribuição por status + mapa de calor.
 *
 * The heatmap supports four dimensions matching the gold reference:
 *   - decisao  — rows = decision sections (decisions[].section), cols = status
 *   - fluxo    — rows = plans, cols = status (1 cell hot per row in v1)
 *   - ac       — rows = AC themes (derived from spec.cite.ac_id prefix), cols = status
 *   - objetivo — rows = business objectives (kind=objective); columns = status
 *
 * Status palette is the 5-cut from gold (ok / partial / gap / blocked / bug).
 * Dimension data is precomputed and embedded as a JSON island so the inline
 * JS can re-render the table without a round-trip.
 *
 * Tab: visao.
 */
import {
  buildAcStatusMap,
  buildDecisionStatusMap,
  buildScenarioStatusMap,
  type CoverStatus,
  planStatusToCut,
} from "../coverage.js";
import { esc } from "../escape.js";
import { readAdjudicated, type SiteAdjudicatedKpis, type SiteInputs } from "../types.js";

type StatusKey = CoverStatus;

interface StatusCut {
  key: StatusKey;
  label: string;
  sym: string;
  bgVar: string;
}

const STATUS_CUTS: ReadonlyArray<StatusCut> = [
  { key: "ok", label: "Coberto", sym: "✓", bgVar: "--ok" },
  { key: "partial", label: "Parcial", sym: "◑", bgVar: "--partial" },
  { key: "gap", label: "Não exec.", sym: "⬜", bgVar: "--gap" },
  { key: "blocked", label: "Bloqueado", sym: "🔒", bgVar: "--blocked" },
  { key: "bug", label: "Bug", sym: "🐞", bgVar: "--bug" },
];

interface HeatGroup {
  name: string;
  cells: Record<StatusKey, number>;
  total: number;
}

interface HeatData {
  unit: string;
  groups: HeatGroup[];
}

function emptyCells(): Record<StatusKey, number> {
  return { ok: 0, partial: 0, gap: 0, blocked: 0, bug: 0 };
}

// ── dimension builders ──────────────────────────────────────────────────────

/** Por plano — rows = plans (1 batched plan vs N flows it covers). */
function buildPlano(inputs: SiteInputs): HeatData {
  const groups: HeatGroup[] = inputs.plans.map((p) => {
    const cells = emptyCells();
    const flowIds = Array.isArray(p["target_test_flow_ids"])
      ? (p["target_test_flow_ids"] as unknown[]).map(String)
      : [];
    const status = planStatusToCut(p["status"]);
    // Each plan contributes 1 plano + N flows in the row's total. We surface
    // the per-flow count so the heatmap reflects "1 plano batchando N fluxos".
    cells[status] = Math.max(1, flowIds.length);
    return {
      name: String(p["name"] ?? p["id"] ?? "?"),
      cells,
      total: Math.max(1, flowIds.length),
    };
  });
  return { unit: "fluxos cobertos", groups };
}

/** Por fluxo — rows = scenarios (the real "fluxos"); status derived from
 *  parent plan + bug-finding refs. 1 plan → N rows. */
function buildFluxo(inputs: SiteInputs): HeatData {
  const scenStatus = buildScenarioStatusMap(inputs);
  // Map scenario id → parent plan name for display context.
  const planNameByScenario = new Map<string, string>();
  for (const p of inputs.plans) {
    const planName = String(p["name"] ?? p["id"] ?? "?");
    const flows = Array.isArray(p["target_test_flow_ids"])
      ? (p["target_test_flow_ids"] as unknown[]).map(String)
      : [];
    for (const f of flows) if (!planNameByScenario.has(f)) planNameByScenario.set(f, planName);
  }
  const groups: HeatGroup[] = inputs.scenarios.map((sc) => {
    const id = String(sc["id"] ?? "?");
    const name = String(sc["name"] ?? id);
    const parentPlanName = planNameByScenario.get(id);
    const cells = emptyCells();
    cells[scenStatus.get(id) ?? "gap"] = 1;
    const displayName = parentPlanName ? `${id} · ${parentPlanName}` : id;
    return { name: name.startsWith(id) ? name : displayName, cells, total: 1 };
  });
  return { unit: "fluxos", groups };
}

// Status precedence, code-cite join, scenario/decision/AC status maps all
// live in ../coverage.js. Imported above.

/** Por decisão — rows = unitary decisions (1 row per decision). Status is
 *  inherited from linked scenarios (via explicit evidence_scenario_ids OR
 *  code-cite overlap). User pointed out: every decision must appear, and
 *  decisions touched by executed flows must inherit "ok". */
function buildDecisao(inputs: SiteInputs): HeatData {
  const decStatus = buildDecisionStatusMap(inputs);
  const groups: HeatGroup[] = inputs.decisions.map((d) => {
    const id = String(d["id"] ?? "?");
    const section = String(d["section"] ?? "");
    const name = section ? `${id} · ${section}` : id;
    const cells = emptyCells();
    cells[decStatus.get(id) ?? "gap"]++;
    return { name, cells, total: 1 };
  });
  return { unit: "decisões", groups };
}

/**
 * Por AC — 1 row per AC spec. Status = derived from `coverage.buildAcStatusMap`
 * (which itself walks decisions→ac_id citations).
 */
function buildAc(inputs: SiteInputs): HeatData {
  const acSpecs = inputs.specs.filter((s) => s["kind"] === "ac");
  if (acSpecs.length === 0) return { unit: "ACs", groups: [] };
  const acStatusByAcId = buildAcStatusMap(inputs);
  const groups: HeatGroup[] = acSpecs.map((s) => {
    const cite = (s["cite"] as Record<string, unknown> | undefined) ?? {};
    const acId = String(cite["ac_id"] ?? s["id"] ?? "");
    const status = acStatusByAcId.get(acId) ?? "gap";
    const cells = emptyCells();
    cells[status]++;
    const title = String(s["title"] ?? "");
    const label = title ? `${acId} · ${title.slice(0, 80)}` : acId;
    return { name: label, cells, total: 1 };
  });
  return { unit: "ACs", groups };
}

/** Por objetivo — rows = specs of kind="objective". */
function buildObjetivo(inputs: SiteInputs): HeatData {
  const objectives = inputs.specs.filter((s) => s["kind"] === "objective");
  if (objectives.length === 0) return { unit: "objetivos", groups: [] };
  const groups: HeatGroup[] = objectives.map((o) => {
    const cells = emptyCells();
    cells.gap = 1; // until objective↔plan linkage lands
    return { name: String(o["title"] ?? o["id"] ?? "?"), cells, total: 1 };
  });
  return { unit: "objetivos", groups };
}

function dataForDimension(dim: string, inputs: SiteInputs): HeatData {
  if (dim === "fluxo") return buildFluxo(inputs);
  if (dim === "plano") return buildPlano(inputs);
  if (dim === "decisao") return buildDecisao(inputs);
  if (dim === "ac") return buildAc(inputs);
  if (dim === "objetivo") return buildObjetivo(inputs);
  return { unit: "", groups: [] };
}

// ── render ──────────────────────────────────────────────────────────────────

function renderDistributionBar(inputs: SiteInputs, total: number): string {
  if (total === 0) return '<p class="faint">(sem planos)</p>';
  const counts: Record<StatusKey, number> = emptyCells();
  for (const p of inputs.plans) counts[planStatusToCut(p["status"])]++;
  const segs = STATUS_CUTS.map((c) => {
    const n = counts[c.key];
    if (n === 0) return "";
    return `<div class="seg" style="flex:${n};background:var(${c.bgVar})" title="${esc(c.label)} ${n}">${n}</div>`;
  })
    .filter(Boolean)
    .join("");
  const legend = STATUS_CUTS.map(
    (c) =>
      `<span><i style="background:var(${c.bgVar})"></i><b>${counts[c.key]}</b> ${esc(c.label)}</span>`,
  ).join("\n");
  return `
<div class="dbar">${segs}</div>
<div class="dlegend">${legend}</div>`;
}

function renderHeatTable(data: HeatData, colhLabel: string): string {
  if (data.groups.length === 0) {
    return `<p class="faint">(sem dados nesta dimensão; o cruzamento ${esc(colhLabel.toLowerCase())} × cenários precisa de mais dados persistidos)</p>`;
  }
  const colMax: Record<StatusKey, number> = emptyCells();
  for (const r of data.groups)
    for (const c of STATUS_CUTS) colMax[c.key] = Math.max(colMax[c.key], r.cells[c.key]);
  function cell(value: number, col: StatusCut): string {
    if (value === 0) return `<td class="cell" style="background:#fbfcfe;color:var(--faint)">—</td>`;
    const max = colMax[col.key] || 1;
    const pct = Math.round(16 + 84 * (value / max));
    const bg = `color-mix(in srgb, var(${col.bgVar}) ${pct}%, #fff)`;
    const fg = pct >= 58 ? "#fff" : "var(--ink)";
    return `<td class="cell" style="background:${bg};color:${fg}">${value}</td>`;
  }
  const totals: Record<StatusKey, number> = emptyCells();
  for (const r of data.groups) for (const c of STATUS_CUTS) totals[c.key] += r.cells[c.key];
  const grand = data.groups.reduce((s, r) => s + r.total, 0);
  const compP =
    grand === 0
      ? 0
      : Math.round(((totals.ok + 0.5 * totals.partial) / grand) * 100);
  const confP = grand === 0 ? 0 : Math.round(((grand - totals.bug) / grand) * 100);
  const head =
    `<thead><tr><th class="ah">${esc(colhLabel)}</th>` +
    STATUS_CUTS.map((c) => `<th><span class="hsym">${c.sym}</span><span>${esc(c.label)}</span></th>`).join("") +
    `<th>Σ</th><th>Compl.</th><th>Conf.</th></tr></thead>`;
  const rows = data.groups
    .map((g) => {
      const cP =
        g.total === 0 ? 0 : Math.round(((g.cells.ok + 0.5 * g.cells.partial) / g.total) * 100);
      const cF = g.total === 0 ? 0 : Math.round(((g.total - g.cells.bug) / g.total) * 100);
      return (
        `<tr><td class="rowh">${esc(g.name)}</td>` +
        STATUS_CUTS.map((c) => cell(g.cells[c.key], c)).join("") +
        `<td class="sum">${g.total}</td>` +
        `<td class="comp" style="color:${cP >= 70 ? "var(--ok)" : cP >= 30 ? "var(--partial)" : "var(--bug)"}">${cP}%</td>` +
        `<td class="comp" style="color:${cF >= 70 ? "var(--ok)" : cF >= 30 ? "var(--partial)" : "var(--bug)"}">${cF}%</td>` +
        `</tr>`
      );
    })
    .join("");
  const total =
    `<tr class="totrow"><td class="rowh">Total</td>` +
    STATUS_CUTS.map((c) => `<td class="cell"><b>${totals[c.key]}</b></td>`).join("") +
    `<td class="sum">${grand}</td>` +
    `<td class="comp" style="color:${compP >= 70 ? "var(--ok)" : compP >= 30 ? "var(--partial)" : "var(--bug)"}">${compP}%</td>` +
    `<td class="comp" style="color:${confP >= 70 ? "var(--ok)" : confP >= 30 ? "var(--partial)" : "var(--bug)"}">${confP}%</td>` +
    `</tr>`;
  return `<table class="heat">${head}<tbody>${rows}${total}</tbody></table>`;
}

/** Gauge percentages — use decisions as the unit so the headline number is
 *  consistent with "Por decisão" in the heatmap (gold's "79% de 53 decisões"
 *  framing). Compl. = decisions covered (ok+0.5*partial); Conf. = decisions
 *  without bug status. */
function computeGaugePcts(inputs: SiteInputs): { compl: number; conf: number } {
  const totalDecisions = inputs.decisions.length;
  if (totalDecisions === 0) return { compl: 0, conf: 0 };
  const decStatus = buildDecisionStatusMap(inputs);
  let ok = 0, partial = 0, bug = 0;
  for (const status of decStatus.values()) {
    if (status === "ok") ok++;
    else if (status === "partial") partial++;
    else if (status === "bug") bug++;
  }
  const compl = Math.round(((ok + 0.5 * partial) / totalDecisions) * 100);
  const conf = Math.round(((totalDecisions - bug) / totalDecisions) * 100);
  return { compl, conf };
}

/**
 * GROUNDED RESULT headline — Completude / Conformidade / BugsApp sourced
 * VERBATIM from `inputs.adjudicated` (runs.db-derived, deterministic). This is
 * THE RESULT, and the only place the headline gauges (`g-compl` / `g-conf`) are
 * painted. The synth-derived heatmap below is a labeled subordinate "design
 * intent" view — never the result.
 *
 * When there is no adjudicated verdict source (`noAdjudicatedData`, or the
 * field is absent because the host is older), this renders an HONEST GAP. It is
 * structurally impossible for this function to emit 0%/100% gauges as the
 * result: in the gap branch the gauges are not rendered at all, and the
 * grounded data-attributes are omitted in favor of `data-no-adjudicated="true"`.
 */
function renderGroundedResult(adj: SiteAdjudicatedKpis | undefined): string {
  // Honest gap: no verdict source. NEVER a 0%/100% synthesized stand-in.
  if (!adj || adj.noAdjudicatedData) {
    return `
  <div class="card result-card result-gap" data-grounded-result="1" data-no-adjudicated="true">
    <h3 style="margin-top:0">Resultado medido <span class="faint">· veredito adjudicado</span></h3>
    <p class="faint" style="margin:0"><b>Sem veredito adjudicado</b> — no adjudicated verdicts.
    Não há fonte de veredito (runs.db) para esta feature: Completude e Conformidade
    <b>não foram medidas</b>. Nenhum valor 0%/100% é exibido como resultado.</p>
  </div>`;
  }
  // Round ONCE for display, with the SAME rule the monitor/cockpit/TUI use
  // (Math.round). The single rounded value flows into the visible text, the
  // data-attribute, AND the gauge data-pct — they cannot diverge, and no raw
  // 15-digit float is ever rendered.
  const complPct = Math.round(adj.completude.pct);
  const confPct = Math.round(adj.conformidade.pct);
  const bugs = adj.bugsApp.count;
  const integ = adj.verdictIntegrity;
  const bugFlows = adj.bugsApp.flows.length
    ? ` <span class="faint">(${adj.bugsApp.flows.map((f) => esc(f)).join(", ")})</span>`
    : "";
  const integNote =
    integ.count > 0
      ? `<li class="faint">Integridade de veredito: <b>${integ.count}</b> meta(s) contraditória(s)/oscilante(s) — <i>nota de integridade, não é bug</i>${
          integ.flows.length ? ` <span>(${integ.flows.map((f) => esc(f)).join(", ")})</span>` : ""
        }</li>`
      : `<li class="faint">Integridade de veredito: <b>0</b> — sem contradições (nota, não é bug)</li>`;
  return `
  <div class="card result-card" data-grounded-result="1"
       data-no-adjudicated="false"
       data-grounded-completude="${complPct}"
       data-grounded-conformidade="${confPct}"
       data-grounded-bugsapp="${bugs}">
    <h3 style="margin-top:0">Resultado medido <span class="faint">· veredito adjudicado</span></h3>
    <div class="dashhead">
      <div class="gaugewrap">
        <div class="gauge" id="g-compl" data-pct="${complPct}"></div>
        <div class="gauge" id="g-conf" data-pct="${confPct}"></div>
      </div>
      <div class="barwrap">
        <ul class="result-kpis" style="margin:0;padding-left:18px">
          <li>Completude <b>${complPct}%</b> <span class="faint">· ${adj.completude.verified}/${adj.completude.addressable} verificados / endereçáveis</span></li>
          <li>Conformidade <b>${confPct}%</b> <span class="faint">· ${adj.conformidade.approved}/${adj.conformidade.addressable} aprovados / endereçáveis</span></li>
          <li>Bugs de aplicação <span class="faint">(resultado adjudicado)</span> <b>${bugs}</b>${bugFlows}</li>
          ${integNote}
        </ul>
      </div>
    </div>
  </div>`;
}

export function renderCompletude(inputs: SiteInputs): string {
  const total = inputs.plans.length;
  const adj = readAdjudicated(inputs);
  const { compl, conf } = computeGaugePcts(inputs);
  const DIM_LABELS: Record<string, string> = {
    decisao: "Decisão",
    objetivo: "Objetivo",
    plano: "Plano",
    fluxo: "Cenário",
    ac: "AC",
  };
  // Pre-serialize every dimension as a JSON island so the inline JS can swap
  // them without a round-trip — same determinism contract as the rest.
  const datas: Record<string, { colh: string; html: string }> = {};
  for (const dim of Object.keys(DIM_LABELS)) {
    const data = dataForDimension(dim, inputs);
    datas[dim] = { colh: DIM_LABELS[dim] ?? "", html: renderHeatTable(data, DIM_LABELS[dim] ?? "") };
  }
  return `
<section id="painel" data-tab="visao">
  <h2>Completude e Cobertura</h2>
  ${renderGroundedResult(adj)}
  <div class="card synth-subordinate" style="margin-top:14px">
    <h3 style="margin-top:0">Síntese (intenção de design) — não é o resultado medido</h3>
    <p class="faint" style="margin-top:0">Derivado dos artefatos de síntese (decisões/planos),
    <b>não</b> de vereditos. Mapa de intenção de design — subordinado ao resultado medido acima.</p>
    <div class="dashhead">
      <div class="barwrap">
        <p style="margin:0 0 10px">Completude (síntese) <b>${compl}%</b> · Conformidade (síntese) <b>${conf}%</b></p>
        <h4 style="margin:0 0 10px">Distribuição por status <span class="faint">· ${total} plano(s)</span></h4>
        ${renderDistributionBar(inputs, total)}
      </div>
    </div>
  </div>
  <div class="card synth-subordinate" style="margin-top:14px">
    <h3 style="margin-top:0">Mapa de calor <span class="faint">(síntese · intenção de design)</span></h3>
    <div class="fbar" id="dimtoggle">
      <button class="fbtn active" data-d="decisao">Por decisão</button>
      <button class="fbtn" data-d="objetivo">Por objetivo</button>
      <button class="fbtn" data-d="plano">Por plano</button>
      <button class="fbtn" data-d="fluxo">Por cenário</button>
      <button class="fbtn" data-d="ac">Por AC</button>
    </div>
    <div id="dash-heat">${datas["decisao"]!.html}</div>
  </div>
  <script type="application/json" id="dash-heat-data">${JSON.stringify(
    Object.fromEntries(Object.entries(datas).map(([k, v]) => [k, v.html])),
  ).replace(/</g, "\\u003c")}</script>
</section>`;
}

/** Inline JS: paint the gauges + wire the dimension toggle. */
export function renderGaugeScript(): string {
  return `
<script>
(function(){
  function compColor(p){ return p>=70?'#16b36a':p>=45?'#f97316':'#e11d48'; }
  function setGauge(el,label){
    const pct = Math.max(0, Math.min(100, parseInt(el.dataset.pct||'0',10)));
    el.style.background='conic-gradient('+compColor(pct)+' '+pct+'%, #eef1f8 0)';
    el.innerHTML='<div class="ginner"><b>'+pct+'%</b><span>'+label+'</span></div>';
  }
  const c=document.getElementById('g-compl'); if(c) setGauge(c,'completude');
  const f=document.getElementById('g-conf');  if(f) setGauge(f,'conformidade');

  /* dimension toggle: swap the heat-table HTML from the JSON island */
  const dataIsland = document.getElementById('dash-heat-data');
  const heat = document.getElementById('dash-heat');
  const toggle = document.getElementById('dimtoggle');
  if (dataIsland && heat && toggle) {
    let DATA = {};
    try { DATA = JSON.parse(dataIsland.textContent || '{}'); } catch(e){}
    toggle.addEventListener('click', (e)=>{
      const b = e.target.closest('.fbtn'); if (!b) return;
      toggle.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const d = b.dataset.d;
      if (DATA[d]) heat.innerHTML = DATA[d];
    });
  }
})();
</script>`;
}
