import type { FullDependencyDiff } from "./index.js";
import { createPostalClientFromEnv } from "./postal-client.js";

type DependencyInfo = {
  name: string;
  datasource: string;
  registryUrl?: string;
  oldVersion: string;
  newVersion: string;
};

type FailedFetch = {
  dependency: string;
  reason: string;
};

function formatTransitiveDepsHtml(transitiveDepsDiffs: Map<string, FullDependencyDiff>): string {
  if (transitiveDepsDiffs.size === 0) {
    return "";
  }

  const sections: string[] = [];

  for (const [chartName, diff] of transitiveDepsDiffs) {
    const hasChanges =
      diff.images.updated.length > 0 || diff.charts.updated.length > 0 || diff.appVersions.updated.length > 0;

    if (!hasChanges) {continue;}

    let sectionHtml = `<h3>${chartName} - Transitive Updates</h3><div class="transitive-section">`;

    // Sub-chart updates
    if (diff.charts.updated.length > 0) {
      sectionHtml += `
      <h4>Sub-chart Updates</h4>
      <table>
        <thead>
          <tr>
            <th>Chart</th>
            <th>Old Version</th>
            <th>New Version</th>
          </tr>
        </thead>
        <tbody>
          ${diff.charts.updated
            .map(
              (c) => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.name}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.oldVersion}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.newVersion}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>`;
    }

    // Image updates
    if (diff.images.updated.length > 0) {
      sectionHtml += `
      <h4>Container Image Updates</h4>
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Old Tag</th>
            <th>New Tag</th>
          </tr>
        </thead>
        <tbody>
          ${diff.images.updated
            .map((img) => {
              const registry = img.registry ? `${img.registry}/` : "";
              return `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${registry}${img.repository}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${img.oldTag}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${img.newTag}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>`;
    }

    // AppVersion updates
    if (diff.appVersions.updated.length > 0) {
      sectionHtml += `
      <h4>AppVersion Updates</h4>
      <ul>
        ${diff.appVersions.updated
          .map((a) => `<li><strong>${a.chartName}</strong>: ${a.oldAppVersion} → ${a.newAppVersion}</li>`)
          .join("\n")}
      </ul>`;
    }

    sectionHtml += "</div>";
    sections.push(sectionHtml);
  }

  if (sections.length === 0) {
    return "";
  }

  return `
  <h2>Transitive Dependency Updates</h2>
  <div class="transitive">
    <p>The following indirect dependencies were also updated as part of the direct dependency changes above.</p>
  </div>
  ${sections.join("\n")}
  `;
}

export function formatEmailHtml(
  changes: DependencyInfo[],
  llmSummary: string,
  failedFetches: FailedFetch[],
  transitiveDepsDiffs: Map<string, FullDependencyDiff>,
): string {
  const changesHtml = changes
    .map(
      (c) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.name}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.oldVersion}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.newVersion}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.datasource}</td>
        </tr>`,
    )
    .join("");

  const failedHtml =
    failedFetches.length > 0
      ? `
  <h2>Failed to Fetch Release Notes (${String(failedFetches.length)})</h2>
  <p style="color: #b45309; background-color: #fef3c7; padding: 10px; border-radius: 4px;">
    The following dependencies could not have their release notes fetched.
    The AI summary for these may be less accurate.
  </p>
  <ul>
    ${failedFetches.map((f) => `<li><strong>${f.dependency}</strong>: ${f.reason}</li>`).join("\n    ")}
  </ul>
  `
      : "";

  // Format transitive dependencies section
  const transitiveDepsHtml = formatTransitiveDepsHtml(transitiveDepsDiffs);

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 30px; }
    h3 { color: #3b82f6; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th { background-color: #2563eb; color: white; padding: 12px 8px; text-align: left; }
    td { padding: 8px; border: 1px solid #ddd; }
    tr:nth-child(even) { background-color: #f8fafc; }
    .summary { background-color: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; }
    .transitive { background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; }
    .transitive-section { margin-left: 20px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em; }
    .dep-chain { color: #6b7280; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Weekly Dependency Update Summary</h1>
  <p>Generated on ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>

  <h2>Direct Dependency Updates (${String(changes.length)})</h2>
  <table>
    <thead>
      <tr>
        <th>Dependency</th>
        <th>Old Version</th>
        <th>New Version</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
      ${changesHtml}
    </tbody>
  </table>

  ${transitiveDepsHtml}

  ${failedHtml}

  <h2>AI Summary</h2>
  <div class="summary">
    ${llmSummary}
  </div>

  <div class="footer">
    <p>This summary was automatically generated by your homelab dependency monitoring system.</p>
    <p>Repository: <a href="https://github.com/shepherdjerred/homelab">shepherdjerred/homelab</a></p>
  </div>
</body>
</html>`;
}

export async function sendEmail(
  subject: string,
  htmlContent: string,
  dryRun: boolean,
): Promise<void> {
  // In dry-run mode, output to markdown file
  if (dryRun) {
    // Convert HTML to markdown
    const markdown = htmlContent
      // Remove style blocks
      .replaceAll(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // Convert headers
      .replaceAll(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
      .replaceAll(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
      .replaceAll(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
      // Convert strong/bold
      .replaceAll(/<strong>(.*?)<\/strong>/gi, "**$1**")
      .replaceAll(/<b>(.*?)<\/b>/gi, "**$1**")
      // Convert em/italic
      .replaceAll(/<em>(.*?)<\/em>/gi, "*$1*")
      .replaceAll(/<i>(.*?)<\/i>/gi, "*$1*")
      // Convert links
      .replaceAll(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      // Convert table - build proper markdown table
      .replaceAll(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent: string) => {
        const rows: string[] = [];
        const rowMatches = tableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
        rowMatches.forEach((row, index) => {
          const cells: string[] = [];
          const cellMatches = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? [];
          cellMatches.forEach((cell) => {
            const content = cell
              .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/i, "$1")
              .replaceAll(/<[^>]+>/g, "")
              .trim();
            cells.push(content);
          });
          rows.push("| " + cells.join(" | ") + " |");
          // Add separator after header row
          if (index === 0) {
            rows.push("|" + cells.map(() => "---").join("|") + "|");
          }
        });
        return "\n" + rows.join("\n") + "\n";
      })
      // Convert list items
      .replaceAll(/<li[^>]*>/gi, "\n- ")
      .replaceAll(/<\/li>/gi, "")
      // Convert paragraphs and divs to newlines
      .replaceAll(/<\/p>/gi, "\n\n")
      .replaceAll(/<p[^>]*>/gi, "")
      .replaceAll(/<\/div>/gi, "\n")
      .replaceAll(/<div[^>]*>/gi, "")
      .replaceAll(/<br\s*\/?>/gi, "\n")
      // Remove remaining tags
      .replaceAll(/<[^>]+>/g, "")
      // Decode HTML entities
      .replaceAll('&amp;', "&")
      .replaceAll('&lt;', "<")
      .replaceAll('&gt;', ">")
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&nbsp;', " ")
      // Clean up whitespace
      .replaceAll(/\n\s*\n\s*\n/g, "\n\n")
      .trim();

    const outputPath = "dependency-summary.md";
    await Bun.write(outputPath, markdown);
    console.log(`\nDRY RUN - Markdown summary written to: ${outputPath}`);
    return;
  }

  const recipientEmail = Bun.env["RECIPIENT_EMAIL"];
  const senderEmail = Bun.env["SENDER_EMAIL"] ?? "updates@homelab.local";

  if (!recipientEmail) {
    console.error("RECIPIENT_EMAIL not set, cannot send email");
    throw new Error("RECIPIENT_EMAIL not set");
  }

  try {
    const postal = createPostalClientFromEnv();
    await postal.sendEmail({
      to: recipientEmail,
      from: senderEmail,
      subject,
      htmlBody: htmlContent,
      tag: "dependency-summary",
    });

    console.log("Email sent successfully via Postal");
  } catch (error) {
    console.error(`Failed to send email: ${String(error)}`);
    throw error;
  }
}
