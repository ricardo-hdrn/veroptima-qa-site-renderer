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
  buildDecisionStatusMap,
  buildGroundedAcStatusMap,
  buildGroundedDecisionStatusMap,
  buildGroundedPlanStatusMap,
  buildGroundedScenarioStatusMap,
  COVER_LABEL,
  type CoverStatus,
  flowStatusToCut,
  planStatusToCut,
  readFlowStatus,
} from "../coverage.js";
import { esc } from "../escape.js";
import {
  type AdjudicatedFlowStatus,
  readAdjudicated,
  type SiteAdjudicatedKpis,
  type SiteInputs,
} from "../types.js";

type StatusKey = CoverStatus;

interface StatusCut {
  key: StatusKey;
  label: string;
  sym: string;
  bgVar: string;
}

/** GROUNDED columns — the execution-truth vocabulary, derived from the per-goal
 *  verdict map. Labels are single-sourced from COVER_LABEL. Sem mapeamento is a
 *  distinct, loud column (never folded into Não executado). */
const GROUNDED_CUTS: ReadonlyArray<StatusCut> = [
  { key: "ok", label: COVER_LABEL.ok, sym: "✓", bgVar: "--ok" },
  { key: "failed", label: COVER_LABEL.failed, sym: "✗", bgVar: "--bug" },
  { key: "gap", label: COVER_LABEL.gap, sym: "⬜", bgVar: "--gap" },
  { key: "blocked", label: COVER_LABEL.blocked, sym: "🔒", bgVar: "--blocked" },
  { key: "misto", label: COVER_LABEL.misto, sym: "◑", bgVar: "--partial" },
  { key: "contradictory", label: COVER_LABEL.contradictory, sym: "⚠", bgVar: "--po" },
  { key: "unmapped", label: COVER_LABEL.unmapped, sym: "❔", bgVar: "--unmapped" },
];

/** SYNTH (design-intent) cuts — used ONLY by the subordinate distribution. */
const SYNTH_CUTS: ReadonlyArray<StatusCut> = [
  { key: "ok", label: "Coberto", sym: "✓", bgVar: "--ok" },
  { key: "partial", label: "Parcial", sym: "◑", bgVar: "--partial" },
  { key: "gap", label: "Não exec.", sym: "⬜", bgVar: "--gap" },
  { key: "blocked", label: "Bloqueado", sym: "🔒", bgVar: "--blocked" },
  { key: "bug", label: "Bug", sym: "🐞", bgVar: "--bug" },
];

interface GroundedRow {
  name: string;
  status: CoverStatus;
}

interface HeatData {
  unit: string;
  rows: GroundedRow[];
}

/** Tally a grounded count vector over exactly the GROUNDED_CUTS keys. */
function emptyGroundedCounts(): Record<StatusKey, number> {
  const out = {} as Record<StatusKey, number>;
  for (const c of GROUNDED_CUTS) out[c.key] = 0;
  return out;
}

// ── grounded dimension builders (per-item status from flowStatus) ────────────

function buildGroundedPlano(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  const planStatus = buildGroundedPlanStatusMap(inputs, flowStatus);
  const rows: GroundedRow[] = inputs.plans.map((p) => ({
    name: String(p["name"] ?? p["id"] ?? "?"),
    status: planStatus.get(String(p["id"] ?? "")) ?? "unmapped",
  }));
  return { unit: "planos", rows };
}

function buildGroundedFluxo(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  const scenStatus = buildGroundedScenarioStatusMap(inputs, flowStatus);
  const rows: GroundedRow[] = inputs.scenarios.map((sc) => {
    const id = String(sc["id"] ?? "?");
    const name = String(sc["name"] ?? id);
    return { name: name.startsWith(id) ? name : `${id} · ${name}`, status: scenStatus.get(id) ?? "unmapped" };
  });
  return { unit: "fluxos", rows };
}

function buildGroundedDecisao(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  const decStatus = buildGroundedDecisionStatusMap(inputs, flowStatus);
  const rows: GroundedRow[] = inputs.decisions.map((d) => {
    const id = String(d["id"] ?? "?");
    const section = String(d["section"] ?? "");
    return { name: section ? `${id} · ${section}` : id, status: decStatus.get(id) ?? "unmapped" };
  });
  return { unit: "decisões", rows };
}

function buildGroundedAc(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  const acSpecs = inputs.specs.filter((s) => s["kind"] === "ac");
  if (acSpecs.length === 0) return { unit: "ACs", rows: [] };
  const acStatus = buildGroundedAcStatusMap(inputs, flowStatus);
  const rows: GroundedRow[] = acSpecs.map((s) => {
    const cite = (s["cite"] as Record<string, unknown> | undefined) ?? {};
    const acId = String(cite["ac_id"] ?? s["id"] ?? "");
    const title = String(s["title"] ?? "");
    return {
      name: title ? `${acId} · ${title.slice(0, 80)}` : acId,
      status: acStatus.get(acId) ?? "unmapped",
    };
  });
  return { unit: "ACs", rows };
}

/** Por objetivo — rows = specs of kind="objective". Transitive via its cited
 *  AC(s) when a path exists; otherwise SEM MAPEAMENTO (honest, never silent). */
function buildGroundedObjetivo(
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  const objectives = inputs.specs.filter((s) => s["kind"] === "objective");
  if (objectives.length === 0) return { unit: "objetivos", rows: [] };
  const acStatus = buildGroundedAcStatusMap(inputs, flowStatus);
  const rows: GroundedRow[] = objectives.map((o) => {
    const cite = (o["cite"] as Record<string, unknown> | undefined) ?? {};
    const acRefs = Array.isArray(o["ac_ids"])
      ? (o["ac_ids"] as unknown[]).map(String)
      : cite["ac_id"]
        ? [String(cite["ac_id"])]
        : [];
    const cuts = acRefs.map((a) => acStatus.get(a)).filter((c): c is CoverStatus => !!c && c !== "unmapped");
    let status: CoverStatus;
    if (cuts.length === 0) status = "unmapped";
    else status = new Set(cuts).size === 1 ? cuts[0]! : "misto";
    return { name: String(o["title"] ?? o["id"] ?? "?"), status };
  });
  return { unit: "objetivos", rows };
}

function dataForDimension(
  dim: string,
  inputs: SiteInputs,
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): HeatData {
  if (dim === "fluxo") return buildGroundedFluxo(inputs, flowStatus);
  if (dim === "plano") return buildGroundedPlano(inputs, flowStatus);
  if (dim === "decisao") return buildGroundedDecisao(inputs, flowStatus);
  if (dim === "ac") return buildGroundedAc(inputs, flowStatus);
  if (dim === "objetivo") return buildGroundedObjetivo(inputs, flowStatus);
  return { unit: "", rows: [] };
}

// ── render ──────────────────────────────────────────────────────────────────

/** GROUNDED distribution — tallies the per-goal verdict map DIRECTLY, so the
 *  bar reconciles to `flowStatus` by construction (the headline's per-item
 *  grain). When no verdict source exists, render an honest gap. */
function renderGroundedDistributionBar(
  flowStatus: Record<string, AdjudicatedFlowStatus> | undefined,
): string {
  if (!flowStatus || Object.keys(flowStatus).length === 0) {
    return '<p class="faint">(sem vereditos por meta — Completude/Conformidade não medidas)</p>';
  }
  const counts = emptyGroundedCounts();
  for (const s of Object.values(flowStatus)) counts[flowStatusToCut(s)]++;
  const segs = GROUNDED_CUTS.map((c) => {
    const n = counts[c.key];
    if (n === 0) return "";
    return `<div class="seg" style="flex:${n};background:var(${c.bgVar})" title="${esc(c.label)} ${n}">${n}</div>`;
  })
    .filter(Boolean)
    .join("");
  // Legend carries machine-readable data-v per cut (single-sourced count+label).
  const legend = GROUNDED_CUTS.map(
    (c) =>
      `<span data-v="${c.key}"><i style="background:var(${c.bgVar})"></i><b>${counts[c.key]}</b> ${esc(c.label)}</span>`,
  ).join("\n");
  return `
<div class="dbar">${segs}</div>
<div class="dlegend">${legend}</div>`;
}

/** SYNTH (design-intent) distribution — subordinate; reads plan.status. */
function renderSynthDistributionBar(inputs: SiteInputs, total: number): string {
  if (total === 0) return '<p class="faint">(sem planos)</p>';
  const counts = {} as Record<StatusKey, number>;
  for (const c of SYNTH_CUTS) counts[c.key] = 0;
  for (const p of inputs.plans) counts[planStatusToCut(p["status"])]++;
  const segs = SYNTH_CUTS.map((c) => {
    const n = counts[c.key];
    if (n === 0) return "";
    return `<div class="seg" style="flex:${n};background:var(${c.bgVar})" title="${esc(c.label)} ${n}">${n}</div>`;
  })
    .filter(Boolean)
    .join("");
  const legend = SYNTH_CUTS.map(
    (c) =>
      `<span><i style="background:var(${c.bgVar})"></i><b>${counts[c.key]}</b> ${esc(c.label)}</span>`,
  ).join("\n");
  return `
<div class="dbar">${segs}</div>
<div class="dlegend">${legend}</div>`;
}

/** Grounded heat table — rows = items, columns = GROUNDED_CUTS, ONE hot cell
 *  per row. The row's `data-v="<status>"` is the SINGLE SOURCE for the machine
 *  gate AND the hot cell (they cannot diverge). */
function renderHeatTable(data: HeatData, colhLabel: string): string {
  if (data.rows.length === 0) {
    return `<p class="faint">(sem itens nesta dimensão)</p>`;
  }
  const totals = emptyGroundedCounts();
  for (const r of data.rows) totals[r.status] = (totals[r.status] ?? 0) + 1;
  function cell(rowStatus: CoverStatus, col: StatusCut): string {
    if (rowStatus !== col.key)
      return `<td class="cell" style="background:#fbfcfe;color:var(--faint)">—</td>`;
    const bg = `color-mix(in srgb, var(${col.bgVar}) 84%, #fff)`;
    return `<td class="cell" style="background:${bg};color:#fff">1</td>`;
  }
  const head =
    `<thead><tr><th class="ah">${esc(colhLabel)}</th>` +
    GROUNDED_CUTS.map(
      (c) => `<th><span class="hsym">${c.sym}</span><span>${esc(c.label)}</span></th>`,
    ).join("") +
    `<th>Σ</th></tr></thead>`;
  const rows = data.rows
    .map(
      (r) =>
        `<tr data-v="${r.status}"><td class="rowh">${esc(r.name)}</td>` +
        GROUNDED_CUTS.map((c) => cell(r.status, c)).join("") +
        `<td class="sum">1</td></tr>`,
    )
    .join("");
  const grand = data.rows.length;
  const total =
    `<tr class="totrow"><td class="rowh">Total</td>` +
    GROUNDED_CUTS.map((c) => `<td class="cell" data-v="${c.key}"><b>${totals[c.key] ?? 0}</b></td>`).join("") +
    `<td class="sum">${grand}</td></tr>`;
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
  const flowStatus = readFlowStatus(inputs);
  const { compl, conf } = computeGaugePcts(inputs);
  const DIM_LABELS: Record<string, string> = {
    decisao: "Decisão",
    objetivo: "Objetivo",
    plano: "Plano",
    fluxo: "Cenário",
    ac: "AC",
  };
  // Pre-serialize every GROUNDED dimension as a JSON island so the inline JS can
  // swap them without a round-trip — same determinism contract as the rest.
  // Each cell/row status is derived from the per-goal verdict map (flowStatus).
  const datas: Record<string, { colh: string; html: string }> = {};
  for (const dim of Object.keys(DIM_LABELS)) {
    const data = dataForDimension(dim, inputs, flowStatus);
    datas[dim] = { colh: DIM_LABELS[dim] ?? "", html: renderHeatTable(data, DIM_LABELS[dim] ?? "") };
  }
  const groundedAvailable = !!flowStatus && Object.keys(flowStatus).length > 0;
  return `
<section id="painel" data-tab="visao">
  <h2>Completude e Cobertura</h2>
  ${renderGroundedResult(adj)}
  <div class="card" data-grounded-body="${groundedAvailable ? "1" : "0"}" style="margin-top:14px">
    <h3 style="margin-top:0">Cobertura de execução <span class="faint">· por veredito adjudicado (por meta)</span></h3>
    <p class="faint" style="margin-top:0">Status por item derivado do <b>mapa de vereditos por meta</b>
    (a mesma fonte do resultado medido acima, na granularidade de item) — <b>não</b> da síntese.
    Itens sem fluxo/veredito associável aparecem como <b>Sem mapeamento</b> (lacuna explícita, nunca silenciada como “Não executado”).</p>
    <div class="dashhead">
      <div class="barwrap">
        <h4 style="margin:0 0 10px">Distribuição por status <span class="faint">· vereditos por meta</span></h4>
        ${renderGroundedDistributionBar(flowStatus)}
      </div>
    </div>
    <div class="fbar" id="dimtoggle" style="margin-top:14px">
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
  <div class="card synth-subordinate" style="margin-top:14px">
    <h3 style="margin-top:0">Síntese (intenção de design) — não é o resultado medido</h3>
    <p class="faint" style="margin-top:0">Derivado dos artefatos de síntese (decisões/planos),
    <b>não</b> de vereditos. Mapa de intenção de design — subordinado ao resultado medido acima.</p>
    <div class="dashhead">
      <div class="barwrap">
        <p style="margin:0 0 10px">Completude (síntese) <b>${compl}%</b> · Conformidade (síntese) <b>${conf}%</b></p>
        <h4 style="margin:0 0 10px">Distribuição por status <span class="faint">· ${total} plano(s)</span></h4>
        ${renderSynthDistributionBar(inputs, total)}
      </div>
    </div>
  </div>
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
