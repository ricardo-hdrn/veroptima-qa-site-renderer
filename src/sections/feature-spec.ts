/**
 * §02 Especificação fundamentada — gold-reference shape:
 *   Card 1: Dimensão da Feature (KPI tile grid `.kv` — endpoints / entidades /
 *           migrações / form fields / form conditionals / enum states)
 *   Card 2: Endpoints REST (table.spec — method+path, line range, auth_notes)
 *   Card 3: Entidade & estados (per-entity: prose w/ columns chips + enum chips
 *           from `enum_constants`)
 *   Card 4: Migrações decisivas (table.spec from `tables[]` — migration_ref +
 *           schema.name + columns count)
 */
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

interface SynthsCounts {
  endpoints: number;
  entities: number;
  migrations: number;
  formComponents: number;
  formConditionals: number;
  enumStates: number;
}

function countSynths(synths: Record<string, unknown>): SynthsCounts {
  const len = (k: string) => (Array.isArray(synths[k]) ? (synths[k] as unknown[]).length : 0);
  let enumStates = 0;
  if (Array.isArray(synths["entities"])) {
    for (const e of synths["entities"] as Array<Record<string, unknown>>) {
      const constants = Array.isArray(e["enum_constants"])
        ? (e["enum_constants"] as Array<Record<string, unknown>>)
        : [];
      for (const c of constants) {
        const list = Array.isArray(c["constants"]) ? (c["constants"] as unknown[]) : [];
        enumStates += list.length;
      }
    }
  }
  return {
    endpoints: len("endpoints"),
    entities: len("entities"),
    migrations: len("tables"),
    formComponents: len("form_components"),
    formConditionals: len("form_conditionals"),
    enumStates,
  };
}

function renderDimensao(synths: Record<string, unknown>): string {
  const c = countSynths(synths);
  function tile(n: number, t: string): string {
    return `<div class="b"><div class="n">${n}</div><div class="t">${esc(t)}</div></div>`;
  }
  return `
<div class="card">
  <h3 style="margin-top:0">Dimensão da Feature</h3>
  <div class="kv">
    ${tile(c.endpoints, "endpoints REST")}
    ${tile(c.entities, "entidades")}
    ${tile(c.migrations, "migrações / DDL")}
    ${tile(c.formComponents, "campos de formulário")}
    ${tile(c.formConditionals, "condicionais de formulário")}
    ${tile(c.enumStates, "estados (enum)")}
  </div>
</div>`;
}

function lineCite(ref: unknown): string {
  if (!ref || typeof ref !== "object") return "";
  const r = ref as Record<string, unknown>;
  const file = String(r["file"] ?? "");
  const lr = String(r["line_range"] ?? "");
  if (!file) return "";
  const short = file.split("/").slice(-1)[0] ?? file;
  return `<span class="mono" title="${esc(file)}${lr ? `:${esc(lr)}` : ""}">${esc(short)}${lr ? `:${esc(lr)}` : ""}</span>`;
}

function renderEndpoints(synths: Record<string, unknown>): string {
  const eps = synths["endpoints"];
  if (!Array.isArray(eps) || eps.length === 0) {
    return `<div class="card"><h3 style="margin-top:0">Endpoints REST</h3><p class="faint">(sem endpoints em synths.endpoints)</p></div>`;
  }
  const rows = (eps as Array<Record<string, unknown>>)
    .map((e) => {
      const method = String(e["method"] ?? "?");
      const path = String(e["path"] ?? "?");
      const auth = String(e["auth_notes"] ?? "");
      const provenance = String(e["provenance"] ?? "");
      const ref = e["controller_ref"];
      const lineRange =
        ref && typeof ref === "object" ? String((ref as Record<string, unknown>)["line_range"] ?? "") : "";
      return `<tr>
        <td class="mono"><b>${esc(method)}</b> ${esc(path)}</td>
        <td class="mono">${lineRange ? `:${esc(lineRange)}` : '<span class="faint">—</span>'}</td>
        <td>${auth ? esc(auth) : `<span class="faint">${provenance === "verified" ? "verificado" : "—"}</span>`}</td>
      </tr>`;
    })
    .join("");
  return `
<div class="card" style="margin-top:14px">
  <h3 style="margin-top:0">Endpoints REST <span class="cnt">${eps.length}</span></h3>
  <table class="spec">
    <thead><tr><th>Método + caminho</th><th>Linha</th><th>Auth / observações</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderEntities(synths: Record<string, unknown>): string {
  const ents = synths["entities"];
  if (!Array.isArray(ents) || ents.length === 0) {
    return `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Entidade &amp; estados</h3><p class="faint">(sem entidades em synths.entities)</p></div>`;
  }
  const cards = (ents as Array<Record<string, unknown>>)
    .map((e) => {
      const name = String(e["name"] ?? "?");
      const classRef = e["class_ref"];
      const table = e["table"] as Record<string, unknown> | undefined;
      const tableName = table
        ? `${String(table["schema"] ?? "")}.${String(table["name"] ?? "")}`
        : "";
      const columns = Array.isArray(e["columns"]) ? (e["columns"] as Array<Record<string, unknown>>) : [];
      const colChips = columns
        .map(
          (c) =>
            `<span title="${esc(`${c["java_field"] ?? ""} (${c["nullable"] ? "null" : "not null"})`)}">${esc(String(c["column_name"] ?? ""))}</span>`,
        )
        .join("");
      const enumGroups = Array.isArray(e["enum_constants"])
        ? (e["enum_constants"] as Array<Record<string, unknown>>)
        : [];
      const enumSections = enumGroups
        .map((g) => {
          const typeName = String(g["type_name"] ?? "");
          const list = Array.isArray(g["constants"]) ? (g["constants"] as Array<Record<string, unknown>>) : [];
          const chips = list
            .map((c) => `<span>${esc(String(c["name"] ?? ""))}</span>`)
            .join("");
          return `
<p class="enum-label">Enum ${esc(typeName)} <span class="cnt">${list.length}</span></p>
<div class="enumlist">${chips}</div>`;
        })
        .join("");
      return `
<div class="card" style="margin-top:14px">
  <h3 style="margin-top:0">Entidade <span class="mono">${esc(name)}</span></h3>
  <p style="font-size:13.5px;margin:0 0 10px">
    ${classRef ? lineCite(classRef) : ""}
    ${tableName ? ` · tabela <span class="mono">${esc(tableName)}</span>` : ""}
  </p>
  ${columns.length > 0 ? `<p class="enum-label">Colunas <span class="cnt">${columns.length}</span></p><div class="enumlist">${colChips}</div>` : ""}
  ${enumSections}
</div>`;
    })
    .join("");
  return cards;
}

function renderMigrations(synths: Record<string, unknown>): string {
  const tables = synths["tables"];
  if (!Array.isArray(tables) || tables.length === 0) {
    return `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Migrações</h3><p class="faint">(synths.tables vazio)</p></div>`;
  }
  const rows = (tables as Array<Record<string, unknown>>)
    .map((t) => {
      const schema = String(t["schema"] ?? "");
      const name = String(t["name"] ?? "");
      const cols = Array.isArray(t["columns"]) ? (t["columns"] as unknown[]).length : 0;
      const pk = Array.isArray(t["primary_key"]) ? (t["primary_key"] as unknown[]).map(String).join(", ") : "";
      return `<tr>
        <td>${lineCite(t["migration_ref"]) || '<span class="faint">—</span>'}</td>
        <td><span class="mono">${esc(schema)}${schema ? "." : ""}${esc(name)}</span></td>
        <td>${cols} coluna(s)${pk ? ` · PK <span class="mono">${esc(pk)}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return `
<div class="card" style="margin-top:14px">
  <h3 style="margin-top:0">Migrações <span class="cnt">${tables.length}</span></h3>
  <table class="spec">
    <thead><tr><th>Migração</th><th>Tabela</th><th>O que cria</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function renderFeatureSpec(inputs: SiteInputs): string {
  return `
<section id="feature-spec" data-tab="spec">
  <h2><span class="num">02</span>Especificação</h2>
  ${renderDimensao(inputs.synths)}
  ${renderEndpoints(inputs.synths)}
  ${renderEntities(inputs.synths)}
  ${renderMigrations(inputs.synths)}
</section>`;
}
