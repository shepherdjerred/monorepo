import { describe, expect, it } from "vitest";
import * as fixtures from "#testing/model-fixtures.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { ApprovalQueue } from "./approval-queue.tsx";
import { awaitsDecision } from "./view.ts";

function render(node: Parameters<typeof renderWithRouter>[0]) {
  return renderWithRouter(node).replaceAll("<!-- -->", "");
}

describe("the approval queue", () => {
  const first = fixtures.approvalQueue.find((item) => awaitsDecision(item));
  if (first === undefined) throw new Error("fixture has a waiting approval");

  it("leads each row with the service and environment the overview names", () => {
    const html = render(
      <ApprovalQueue
        items={[first]}
        services={[
          {
            id: first.serviceId,
            title: "Scout for LoL",
            environments: [{ id: first.environmentId, name: "prod" }],
          },
        ]}
        revisions={[{ id: first.id, versionSetRevision: 44 }]}
      />,
    );
    expect(html).toContain(">Scout for LoL · prod</a>");
    expect(html).toContain(
      `aria-label="Deployment to Scout for LoL · prod (${first.environmentId}), ${first.kind} r44, requested `,
    );
    expect(html).toContain('<span class="revision">r44</span>');
    expect(html).toContain('aria-label="Version set r44"');
    // The waiting panel stands apart and counts what it holds.
    expect(html).toContain('class="panel panel-waiting"');
    expect(html).toContain('<span class="muted"> (1)</span>');
  });

  it("says an id the catalog does not hold as words, with the slug in the title", () => {
    const html = render(
      <ApprovalQueue
        items={[
          {
            ...first,
            serviceId: "starlight-karma-bot",
            environmentId: "starlight-karma-bot/prod",
          },
        ]}
      />,
    );
    expect(html).toContain(">Starlight Karma Bot · prod</a>");
    expect(html).toContain(
      'title="starlight-karma-bot · starlight-karma-bot/prod"',
    );
    expect(html).not.toContain(">starlight-karma-bot");
  });

  it("names a numbered recipe and configuration by their number, the whole id in the title", () => {
    const html = render(
      <ApprovalQueue
        items={[
          {
            ...first,
            selection: first.selection && {
              ...first.selection,
              recipeRevisionId: "scout-prod/2",
              configurationRevisionId: "scout-prod/7",
            },
          },
        ]}
      />,
    );
    expect(html).toContain('<span title="scout-prod/2">recipe 2</span>');
    expect(html).toContain('<span title="scout-prod/7">configuration 7</span>');
    expect(html).not.toContain(">scout-prod/2<");
  });

  it("calls an undecided approval awaiting approval, as every other page does", () => {
    const html = render(
      <ApprovalQueue
        items={[
          {
            ...first,
            approval: first.approval && {
              ...first.approval,
              status: "pending",
            },
          },
        ]}
      />,
    );
    expect(html).toContain('class="status status-awaiting_approval"');
    expect(html).toContain(
      '<span class="status-label">awaiting approval</span>',
    );
    expect(html).not.toContain(">pending<");
  });

  it("shows the full recipe and configuration ids so the revision is never cut off", () => {
    const recipe = "starlight-karma-bot-recipe-revision-with-a-long-name";
    const html = render(
      <ApprovalQueue
        items={[
          {
            ...first,
            selection: first.selection && {
              ...first.selection,
              recipeRevisionId: recipe,
            },
          },
        ]}
      />,
    );
    expect(html).toContain(`<span class="mono">${recipe}</span>`);
    expect(html).not.toContain("…");
  });

  it("names the selection by a short id when no number is loaded", () => {
    const id = "0f9d6a52-4c1e-4f7e-9a51-2b7d3c8e1f00";
    const html = render(
      <ApprovalQueue
        items={[{ ...first, versionSetRevisionId: id, selection: null }]}
      />,
    );
    expect(html).toContain('aria-label="Version set 0f9d6a52"');
    expect(html).toContain(`title="${id}"`);
    expect(html).not.toContain(`>${id}</a>`);
  });

  it("collapses expired approvals behind their count, after the decided ones", () => {
    const html = render(<ApprovalQueue items={fixtures.approvalQueue} />);
    const expired = fixtures.approvalQueue.filter(
      (item) => item.approval?.status === "expired",
    );
    expect(expired.length).toBeGreaterThan(0);
    const section = html.slice(
      html.indexOf('aria-labelledby="expired-heading"'),
    );
    expect(section).toMatch(/<details class="disclosure">/u);
    expect(section).not.toContain('<details class="disclosure" open');
    expect(section).toContain(
      `<span class="disclosure-count">${String(expired.length)}</span>`,
    );
    if (html.includes("decided-heading"))
      expect(html.indexOf("decided-heading")).toBeLessThan(
        html.indexOf("expired-heading"),
      );
  });
});
