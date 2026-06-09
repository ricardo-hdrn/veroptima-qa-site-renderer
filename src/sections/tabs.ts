/**
 * Sticky tab nav for grouping sections — mirrors the gold reference's
 * `<nav class="toc">` + `section[data-tab]` pattern.
 *
 * Section → tab assignment (renderer convention):
 *   visao     — Completude (painel) · §01 What-does · §06 Bugs+Contradictions · §07 PM/PO
 *   spec      — §02 Feature spec
 *   criterios — §03 Objectives + ACs
 *   casos     — §04 Plans
 *   cobertura — §05 Decision coverage
 *   metodo    — §08 Execution
 *
 * The tab data attribute on each <section> is set by the section
 * renderers themselves (so they own where they land). This module owns
 * the nav HTML + the show/hide script.
 */

export const TABS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "visao", label: "Visão geral" },
  { id: "cobertura", label: "Cobertura detalhada" },
  { id: "casos", label: "Casos de teste" },
  { id: "spec", label: "Especificação" },
  { id: "criterios", label: "Critérios (ACs)" },
  { id: "metodo", label: "Método & custo" },
];

const DEFAULT_TAB = "visao";

export function renderTabNav(): string {
  return `
<nav class="toc">
  <div class="wrap">
    ${TABS.map((t) => `<a data-tab="${t.id}">${t.label}</a>`).join("\n    ")}
  </div>
</nav>`;
}

/** Inline JS: on load, hide non-default tabs; click handler swaps active. */
export function renderTabScript(): string {
  return `
<script>
(function(){
  const DEFAULT = ${JSON.stringify(DEFAULT_TAB)};
  function setTab(name){
    document.querySelectorAll('nav.toc a').forEach(a=>{
      a.classList.toggle('active', a.getAttribute('data-tab')===name);
    });
    document.querySelectorAll('section[data-tab]').forEach(s=>{
      s.classList.toggle('tab-hidden', s.getAttribute('data-tab')!==name);
    });
  }
  setTab(DEFAULT);
  document.querySelectorAll('nav.toc a').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      const t = a.getAttribute('data-tab');
      if (t) setTab(t);
    });
  });
})();
</script>`;
}
