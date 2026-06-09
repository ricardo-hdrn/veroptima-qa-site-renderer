/**
 * §04 Casos de teste, planos & evidências — per-plan card with status,
 * rationale, target test flows, evidence-gallery links.
 *
 * Evidence linking: when a `scenario` id matches an evidence dir name,
 * we surface the dir link. The renderer does NOT inspect file contents;
 * the caller is responsible for copying the evidence into ./evidence/.
 */
import { esc } from "../escape.js";
import type { SiteInputs } from "../types.js";

function renderPlan(
  plan: Record<string, unknown>,
  inputs: SiteInputs,
): string {
  const id = String(plan["id"] ?? "?");
  const name = String(plan["name"] ?? "");
  const status = String(plan["status"] ?? "pending");
  const rationale = String(plan["batching_rationale"] ?? "");
  const flows = Array.isArray(plan["target_test_flow_ids"])
    ? (plan["target_test_flow_ids"] as unknown[]).map((f) => String(f))
    : [];

  const evidenceLinks = flows
    .map((flowId) => {
      const dir = inputs.evidenceDirs.find((d) => d.scenario === flowId);
      if (!dir) return null;
      return `<a class="evidence-link" href="evidence/${encodeURIComponent(flowId)}/">${esc(flowId)} ↗</a>`;
    })
    .filter((x): x is string => x !== null);

  // For blocked plans, surface the reason if present.
  const blockedReason = status === "blocked" ? String(plan["blocked_reason"] ?? plan["reason"] ?? "") : "";

  return `
<article class="plan-card status-${esc(status)}">
  <header>
    <span class="status-badge status-${esc(status)}">${esc(status)}</span>
    <b>${esc(id)}</b>
  </header>
  <div class="plan-name">${esc(name)}</div>
  ${rationale ? `<p class="rationale">${esc(rationale)}</p>` : ""}
  ${
    flows.length
      ? `<div class="flows"><span class="faint">Flows:</span> ${flows
          .map((f) => `<code>${esc(f)}</code>`)
          .join(" · ")}</div>`
      : ""
  }
  ${evidenceLinks.length ? `<div class="evidence">${evidenceLinks.join(" · ")}</div>` : ""}
  ${blockedReason ? `<div class="blocked-reason"><b>Bloqueio:</b> ${esc(blockedReason)}</div>` : ""}
</article>`;
}

export function renderPlans(inputs: SiteInputs): string {
  return `
<section id="plans" data-tab="casos">
  <h2><span class="num">04</span>Casos de teste, planos &amp; evidências</h2>
  ${
    inputs.plans.length === 0
      ? '<p class="faint">(sem planos)</p>'
      : inputs.plans.map((p) => renderPlan(p, inputs)).join("\n")
  }
</section>`;
}
