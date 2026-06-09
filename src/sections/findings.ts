/**
 * §06 Bugs + Contradições + §07 PM/PO Questions.
 *
 * Findings render as cards with the `.cx-h` header pattern: id chip +
 * title + status tag. Contradictions (spec_drift) split into Doc × Código
 * vs Doc × Doc based on `contradiction.source_a.kind` × `source_b.kind`.
 */
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

function citeKind(c: unknown): string {
  if (!c || typeof c !== "object") return "?";
  const k = (c as Record<string, unknown>)["kind"];
  return typeof k === "string" ? k : "?";
}

function renderCitePreview(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  const obj = c as Record<string, unknown>;
  if (obj["kind"] === "code") {
    const file = String(obj["file"] ?? "");
    const ls = obj["line_start"];
    const le = obj["line_end"];
    const range = typeof ls === "number" && typeof le === "number" ? `:${ls}-${le}` : "";
    return `<span class="mono">${esc(file)}${range}</span>`;
  }
  if (obj["kind"] === "doc") {
    return `<span class="mono">${esc(String(obj["doc_path"] ?? ""))}</span>`;
  }
  if (obj["kind"] === "tracker") {
    return `<span class="mono">${esc(String(obj["tracker_url"] ?? ""))}</span>`;
  }
  return `<span class="mono">${esc(JSON.stringify(obj))}</span>`;
}

function renderFinding(f: Record<string, unknown>, tagLabel: string, tagClass: string): string {
  const id = String(f["id"] ?? "?");
  const title = String(f["title"] ?? "");
  const summary = String(f["summary"] ?? "");
  const verdict = f["verdict_flipped"] === true;

  // Predicted-vs-observed pair, if shape carries it.
  const contradiction = f["contradiction"] as Record<string, unknown> | undefined;
  let pair = "";
  if (contradiction) {
    const a = contradiction["source_a"];
    const b = contradiction["source_b"];
    pair = `
<div class="prev-obs">
  <div><span class="lbl">Origem A (${esc(citeKind(a))})</span>${renderCitePreview(a)}</div>
  <div><span class="lbl">Origem B (${esc(citeKind(b))})</span>${renderCitePreview(b)}</div>
</div>`;
  }
  return `
<article class="finding finding-${esc(String(f["kind"] ?? ""))}">
  <div class="cx-h">
    <span class="id">${esc(id)}</span>
    <span class="cx-title">${esc(title)}</span>
    <span class="cxtag ${esc(tagClass)}">${esc(tagLabel)}</span>
    ${verdict ? '<span class="badge verdict-flipped">verdict-flipped</span>' : ""}
  </div>
  ${summary ? `<p class="finding-summary">${esc(summary)}</p>` : ""}
  ${pair}
</article>`;
}

export function renderFindings(inputs: SiteInputs): string {
  const bugs = inputs.findings.filter((f) => f["kind"] === "bug");
  const drifts = inputs.findings.filter((f) => f["kind"] === "spec_drift");
  const questions = inputs.findings.filter((f) => f["kind"] === "po_question");

  // Split spec_drift into Doc × Código vs Doc × Doc.
  const docCode: Record<string, unknown>[] = [];
  const docDoc: Record<string, unknown>[] = [];
  const driftOther: Record<string, unknown>[] = [];
  for (const d of drifts) {
    const c = d["contradiction"] as Record<string, unknown> | undefined;
    if (!c) {
      driftOther.push(d);
      continue;
    }
    const a = citeKind(c["source_a"]);
    const b = citeKind(c["source_b"]);
    const isDocCode = (a === "doc" && b === "code") || (a === "code" && b === "doc");
    const isDocDoc = a === "doc" && b === "doc";
    if (isDocCode) docCode.push(d);
    else if (isDocDoc) docDoc.push(d);
    else driftOther.push(d);
  }

  return `
<section id="achados" data-tab="visao">
  <h2><span class="num">06</span>Bugs</h2>
  ${
    bugs.length === 0
      ? '<p class="faint">(sem bugs registrados)</p>'
      : bugs.map((b) => renderFinding(b, String(b["kind"] ?? "bug"), "bug")).join("\n")
  }
  <h2 style="margin-top:32px">Contradições encontradas</h2>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-top:0">📄 × 💻 Doc × Código <span class="cnt">${docCode.length}</span></h3>
    ${
      docCode.length === 0
        ? '<p class="faint">(sem divergências doc × código)</p>'
        : docCode.map((d) => renderFinding(d, "spec_drift", "bug")).join("\n")
    }
  </div>
  <div class="card" style="margin-top:14px">
    <h3 style="margin-top:0">📄 × 📄 Doc × Doc <span class="cnt">${docDoc.length}</span></h3>
    ${
      docDoc.length === 0
        ? '<p class="faint">(sem contradições doc × doc)</p>'
        : docDoc.map((d) => renderFinding(d, "spec_drift", "q")).join("\n")
    }
  </div>
  ${
    driftOther.length > 0
      ? `<div class="card" style="margin-top:14px">
    <h3 style="margin-top:0">spec_drift (sem contradição estruturada) <span class="cnt">${driftOther.length}</span></h3>
    ${driftOther.map((d) => renderFinding(d, "spec_drift", "resolved")).join("\n")}
  </div>`
      : ""
  }
</section>
<section id="questoes" data-tab="visao">
  <h2><span class="num">07</span>Questões que só o PM/PO pode responder</h2>
  ${
    questions.length === 0
      ? '<p class="faint">(sem perguntas pendentes)</p>'
      : questions.map((q) => renderFinding(q, "po_question", "q")).join("\n")
  }
</section>`;
}
