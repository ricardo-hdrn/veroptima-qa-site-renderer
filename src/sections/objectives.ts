/**
 * §03 Objetivos & critérios de aceitação — ACs grouped into themed cards.
 * Theme derived from `cite.ac_id` (e.g. `AC-ONE-IMOVEL` → group "ONE/IMOVEL").
 * When no ac_id is set, ACs fall into a single "(sem tema)" group.
 */
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

function themeOf(spec: Record<string, unknown>): string {
  const cite = (spec["cite"] as Record<string, unknown> | undefined) ?? {};
  const acId = String(cite["ac_id"] ?? spec["id"] ?? "");
  // Heuristic: theme = second-and-third segment of dash-joined id, capitalised.
  // "AC-CADASTRO-INTERESSADO-FOO" → "Cadastro · Interessado"
  // "AC-ONE-IMOVEL"               → "One · Imovel"
  const parts = acId.split("-").filter((p) => p && p !== "AC" && p !== "SPEC" && p !== "CC");
  if (parts.length === 0) return "(sem tema)";
  if (parts.length === 1) return parts[0]!.toLowerCase();
  return `${parts[0]} · ${parts[1]}`.toLowerCase();
}

function renderSpecRow(spec: Record<string, unknown>): string {
  const id = String(spec["id"] ?? "?");
  const title = String(spec["title"] ?? "");
  const cite = (spec["cite"] as Record<string, unknown> | undefined) ?? {};
  const quote = String(cite["verbatim_quote"] ?? "");
  return `<li class="ac">
    <span class="code">${esc(id)}</span>
    <div class="ac-body">
      <div class="ac-title">${esc(title)}</div>
      ${quote ? `<blockquote>${esc(quote)}</blockquote>` : ""}
    </div>
  </li>`;
}

export function renderObjectives(inputs: SiteInputs): string {
  const objectives = inputs.specs.filter((s) => s["kind"] === "objective");
  const acs = inputs.specs.filter((s) => s["kind"] === "ac");

  // Group ACs by theme.
  const byTheme = new Map<string, Array<Record<string, unknown>>>();
  for (const ac of acs) {
    const theme = themeOf(ac);
    const list = byTheme.get(theme) ?? [];
    list.push(ac);
    byTheme.set(theme, list);
  }
  const themedCards = [...byTheme.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([theme, list]) => `
<div class="card" style="margin-top:14px">
  <h3 style="margin-top:0">Critérios — ${esc(theme)} <span class="cnt">${list.length}</span></h3>
  <ul class="ac-list">${list.map(renderSpecRow).join("\n")}</ul>
</div>`,
    )
    .join("\n");

  return `
<section id="objectives" data-tab="criterios">
  <h2><span class="num">03</span>Objetivos &amp; critérios de aceitação</h2>
  <div class="card">
    <h3 style="margin-top:0">Objetivos de negócio</h3>
    ${
      objectives.length === 0
        ? '<p class="faint">(nenhum spec.kind="objective" registrado)</p>'
        : `<ul>${objectives.map(renderSpecRow).join("\n")}</ul>`
    }
  </div>
  ${
    themedCards ||
    '<div class="card" style="margin-top:14px"><p class="faint">(sem ACs)</p></div>'
  }
</section>`;
}
