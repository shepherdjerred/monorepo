import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as fixtures from "#testing/model-fixtures.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { DeploymentTable } from "./deployment-table.tsx";
import { catalogNames } from "./catalog-name.tsx";
import { Disclosure } from "./disclosure.tsx";
import { Fact, Facts } from "./facts.tsx";
import {
  Identifier,
  Revision,
  revisionLabel,
  shortIdentifier,
} from "./identifier.tsx";
import { Status } from "./status.tsx";

const UUID = "45cf1828-0f01-4bcd-8dab-592769df488f";
const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`;

describe("Facts", () => {
  it("renders each fact as a labelled value in one definition list", () => {
    expect(
      renderToStaticMarkup(
        <Facts>
          <Fact label="Sync">Synced</Fact>
          <Fact label="Revision" mono>
            0.0.0-fixture
          </Fact>
        </Facts>,
      ),
    ).toBe(
      '<dl class="facts"><div><dt>Sync</dt><dd>Synced</dd></div>' +
        '<div><dt>Revision</dt><dd class="mono">0.0.0-fixture</dd></div></dl>',
    );
  });
});

describe("Disclosure", () => {
  it("is a closed native details whose summary carries its count", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="Older candidates" count={7}>
        <p>Body</p>
      </Disclosure>,
    );
    expect(html).toMatch(/^<details class="disclosure"><summary>/u);
    expect(html).toContain(
      '<span class="disclosure-label">Older candidates</span>' +
        '<span class="disclosure-count">7</span>',
    );
    expect(html).toContain('<div class="disclosure-body"><p>Body</p></div>');
  });

  it("opens on request, shows no count without one and never groups by name", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="Commit message" open>
        <p>Body</p>
      </Disclosure>,
    );
    expect(html).toContain('<details class="disclosure" open="">');
    expect(html).not.toContain("disclosure-count");
    expect(html).not.toContain("name=");
  });
});

describe("Identifier", () => {
  it("shortens a UUID to its first group and a digest to twelve hex digits", () => {
    expect(shortIdentifier(UUID)).toBe("45cf1828");
    expect(shortIdentifier(DIGEST)).toBe("sha256:0123456789ab");
  });

  it("cuts a long id of no known shape and keeps a short one whole", () => {
    expect(shortIdentifier("browser/recovery/discord-operation")).toBe(
      "browser/reco…",
    );
    expect(shortIdentifier("arcade/3")).toBe("arcade/3");
  });

  it("shows the short form and keeps the full value in title and text", () => {
    expect(renderToStaticMarkup(<Identifier value={UUID} />)).toBe(
      `<abbr class="mono identifier" title="${UUID}">` +
        '<span aria-hidden="true">45cf1828</span>' +
        `<span class="visually-hidden">${UUID}</span></abbr>`,
    );
  });

  it("renders a short id whole, with nothing to abbreviate", () => {
    expect(renderToStaticMarkup(<Identifier value="arcade/3" />)).toBe(
      '<span class="mono identifier">arcade/3</span>',
    );
  });
});

describe("Revision", () => {
  it("names a set revision by its r-number", () => {
    expect(revisionLabel(274)).toBe("r274");
    expect(renderToStaticMarkup(<Revision revision={274} />)).toBe(
      '<span class="revision">r274</span>',
    );
  });
});

describe("Status", () => {
  it("keeps the value's glyph and color under a page's own words", () => {
    expect(
      renderToStaticMarkup(<Status value="failed" label="CI failed" />),
    ).toBe(
      '<span class="status status-failed">' +
        '<span class="status-glyph" aria-hidden="true">✕</span>' +
        '<span class="status-label">CI failed</span></span>',
    );
  });

  it("marks a state it has not seen yet with a question mark", () => {
    const html = renderToStaticMarkup(
      <Status value="unknown" label="Not seen yet" />,
    );
    expect(html).toContain('class="status status-unknown"');
    expect(html).toContain(">?</span>");
  });
});

describe("DeploymentTable", () => {
  const deployment = fixtures.deployments.settled38;

  it("names the release by revision number and links it to the version set", () => {
    const html = renderWithRouter(
      <DeploymentTable
        deployments={[{ ...deployment, versionSetRevision: 274 }]}
        empty="None"
      />,
    );
    expect(html).toContain(
      `href="/versions/${encodeURIComponent(deployment.versionSetRevisionId)}"`,
    );
    expect(html).toContain('<span class="revision">r274</span>');
    expect(html).not.toContain(`>${deployment.versionSetRevisionId}<`);
  });

  it("says so when there is nothing to list", () => {
    expect(
      renderWithRouter(<DeploymentTable deployments={[]} empty="None yet" />),
    ).toBe('<p class="empty">None yet</p>');
  });

  it("names each link by what it opens, keeping its visible text", () => {
    const html = renderWithRouter(
      <DeploymentTable
        deployments={[{ ...deployment, versionSetRevision: 4 }]}
        empty="None"
      />,
    );
    expect(html).toContain(
      `aria-label="Deployment to ${deployment.environmentId}, ${deployment.kind} r4, `,
    );
    // Without the catalog, the environment reads as its id.
    expect(html).toContain(
      `<span class="mono">${deployment.environmentId}</span></a>`,
    );
    expect(html).toContain('aria-label="Version set r4"');
    // Narrow, each cell stacks under its label.
    expect(html).toContain('class="table-scroll stack-table"');
    expect(html).toContain('data-label="Requested"');
  });

  it("names an environment as the overview does, its id in the title", () => {
    const html = renderWithRouter(
      <DeploymentTable
        deployments={[{ ...deployment, versionSetRevision: 4 }]}
        empty="None"
        names={catalogNames([
          {
            id: deployment.serviceId,
            title: "Display title",
            environments: [{ id: deployment.environmentId, name: "prod" }],
          },
        ])}
      />,
    );
    expect(html).toContain(
      `<span title="${deployment.environmentId}">Display title prod</span></a>`,
    );
  });

  it("says a failed deployment needs recovery when its record does", () => {
    const html = renderWithRouter(
      <DeploymentTable
        deployments={[
          {
            ...deployment,
            versionSetRevision: 4,
            status: "failed",
            recoveryRequired: true,
          },
        ]}
        empty="None"
      />,
    );
    expect(html).toContain("failed · recovery required");
  });

  it("omits the environment on a page scoped to one", () => {
    const html = renderWithRouter(
      <DeploymentTable
        deployments={[{ ...deployment, versionSetRevision: 4 }]}
        empty="None"
        showEnvironment={false}
      />,
    );
    expect(html).not.toContain(`>${deployment.environmentId}<`);
    expect(html).toContain('<th scope="col">Kind</th>');
    expect(html).toContain(`>${deployment.kind}</a>`);
  });
});
