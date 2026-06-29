/**
 * §05 Mapa de cobertura de decisões — full decision matrix with status,
 * touches_persistence flag, evidence_scenario_ids. Filter buttons by status.
 *
 * Status derived via the shared coverage helper so this table matches the
 * §Completude heatmap "Por decisão" totals row-for-row.
 */
import {
  buildGroundedDecisionStatusMap,
  COVER_LABEL,
  type CoverStatus,
  readFlowStatus,
} from "../coverage.js";
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

// Single-sourced from the coverage module — the label and the `data-v` cannot
// diverge.
const PILL_LABEL: Record<CoverStatus, string> = COVER_LABEL;

export function renderDecisions(inputs: SiteInputs): string {
  if (inputs.decisions.length === 0) {
    return `
<section id="cobertura" data-tab="cobertura">
  <h2><span class="num">05</span>Mapa de cobertura de decisões</h2>
  <p class="faint">(sem decisões registradas)</p>
</section>`;
  }
  // GROUNDED: decision status is the TRANSITIVE join decision → linked
  // scenario(s) → scenario.flow_id → per-goal verdict map. A decision with no
  // resolvable flow renders SEM MAPEAMENTO (loud gap), never silent "Não exec.".
  const decStatus = buildGroundedDecisionStatusMap(inputs, readFlowStatus(inputs));
  const rows = inputs.decisions
    .map((d) => {
      const id = String(d["id"] ?? "?");
      const ifT = String(d["if_expression"] ?? "");
      const thenT = String(d["then_expression"] ?? "");
      const section = String(d["section"] ?? "");
      const text = ifT && thenT ? `${ifT} ⇒ ${thenT}` : String(d["title"] ?? d["if_then_text"] ?? "");
      const persists = d["touches_persistence"] === true;
      const status = decStatus.get(id) ?? "unmapped";
      const evidence = Array.isArray(d["evidence_scenario_ids"])
        ? (d["evidence_scenario_ids"] as unknown[]).map((x) => String(x))
        : [];
      return `<tr data-v="${status}">
        <td class="mono">${esc(id)}</td>
        <td>${esc(section)}</td>
        <td>${esc(text)}</td>
        <td><span class="pill pill-${status}">${esc(PILL_LABEL[status])}</span></td>
        <td>${persists ? '<span class="badge badge-persist">persiste</span>' : ""}</td>
        <td>${
          evidence.length
            ? evidence.map((e) => `<code>${esc(e)}</code>`).join(" · ")
            : '<span class="faint">—</span>'
        }</td>
      </tr>`;
    })
    .join("\n");
  return `
<section id="cobertura" data-tab="cobertura">
  <h2><span class="num">05</span>Mapa de cobertura de decisões</h2>
  <div class="fbar" id="covfilters">
    <button class="fbtn active" data-f="all">Todos</button>
    <button class="fbtn" data-f="ok">✓ Coberto</button>
    <button class="fbtn" data-f="failed">✗ Falhou</button>
    <button class="fbtn" data-f="gap">⬜ Não executado</button>
    <button class="fbtn" data-f="blocked">🔒 Bloqueado</button>
    <button class="fbtn" data-f="unmapped">❔ Sem mapeamento</button>
    <button class="fbtn" data-f="excluded">∅ Excluído</button>
  </div>
  <table class="data-table">
    <thead><tr><th>ID</th><th>Seção</th><th>IF ⇒ THEN</th><th>Status</th><th>Persistência</th><th>Cenários</th></tr></thead>
    <tbody id="cov-rows">${rows}</tbody>
  </table>
</section>`;
}

export function renderDecisionsScript(): string {
  return `
<script>
(function(){
  const bar = document.getElementById('covfilters');
  if (!bar) return;
  bar.addEventListener('click', (e)=>{
    const b = e.target.closest('.fbtn'); if (!b) return;
    bar.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const f = b.dataset.f;
    document.querySelectorAll('#cov-rows tr').forEach(r=>{
      r.style.display = (f==='all' || r.dataset.v===f) ? '' : 'none';
    });
  });
})();
</script>`;
}
