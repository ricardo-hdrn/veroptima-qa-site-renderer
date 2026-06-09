/**
 * §01 O que faz & o que não faz — two `.listcard`s side by side.
 * Status dots before the h3 (ok/bug) match the gold reference pattern.
 */
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

export function renderWhatDoes(inputs: SiteInputs): string {
  const ticked: string[] = [];
  const blocked: string[] = [];
  for (const p of inputs.plans) {
    const id = String(p["id"] ?? "?");
    const name = String(p["name"] ?? p["title"] ?? "");
    const status = p["status"];
    const row = `<li><b class="mono">${esc(id)}</b> ${esc(name) || '<span class="faint">(sem nome)</span>'}</li>`;
    if (status === "ticked") ticked.push(row);
    else if (status === "blocked" || status === "split") blocked.push(row);
  }
  return `
<section id="what-does" data-tab="visao">
  <h2><span class="num">01</span>O que faz &amp; o que não faz</h2>
  <div class="grid-2col">
    <div class="card listcard">
      <h3><span class="dot dot-ok"></span>Faz — verificado <span class="cnt">${ticked.length}</span></h3>
      <ul>${ticked.join("\n") || '<li class="faint">(sem entradas)</li>'}</ul>
    </div>
    <div class="card listcard">
      <h3><span class="dot dot-bug"></span>Não faz / não alcançado <span class="cnt">${blocked.length}</span></h3>
      <ul>${blocked.join("\n") || '<li class="faint">(sem entradas)</li>'}</ul>
    </div>
  </div>
</section>`;
}
