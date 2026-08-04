import { type ReactElement } from "react";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

function checkClass(bucket: string): string {
  const value = bucket.toLowerCase();
  if (
    value.includes("pass") ||
    value.includes("success") ||
    value.includes("green")
  ) {
    return "ok";
  }
  if (
    value.includes("fail") ||
    value.includes("error") ||
    value.includes("red")
  ) {
    return "bad";
  }
  return "pending";
}

export function EvidencePanel({ pr }: { pr: PrState }): ReactElement {
  const e = pr.evidence;
  return (
    <div className="evidence">
      <div className="evidence-grid">
        <span className="k">status</span>
        <span className="v">{pr.status}</span>
        <span className="k">classification</span>
        <span className="v">{pr.classification}</span>
        <span className="k">head</span>
        <span className="v mono">{pr.identity.headSha.slice(0, 12)}</span>
        <span className="k">worktree</span>
        <span className="v mono">{pr.worktree ?? "—"}</span>
        <span className="k">priority</span>
        <span className="v">{pr.priority}</span>
        <span className="k">review</span>
        <span className="v">
          {e.hostedReviewComplete ? "complete" : "pending"}
        </span>
      </div>

      {e.conflict ? <p className="banner bad">Merge conflict</p> : null}
      {pr.escalation === null ? null : (
        <p className="banner warn">Escalation: {pr.escalation}</p>
      )}

      <h4>CI checks ({e.checks.length})</h4>
      {e.checks.length === 0 ? (
        <p className="empty">No checks reported.</p>
      ) : (
        <ul className="checks">
          {e.checks.map((check) => (
            <li key={check.name} className={checkClass(check.bucket)}>
              <span className="check-name">{check.name}</span>
              <span className="check-state">{check.state}</span>
            </li>
          ))}
        </ul>
      )}

      {e.buildkiteFailure === null ? null : (
        <div className="bk-failure">
          <h4>Buildkite failure</h4>
          <p className="mono">{e.buildkiteFailure.name}</p>
          <a href={e.buildkiteFailure.webUrl} target="_blank" rel="noreferrer">
            open job ↗
          </a>
        </div>
      )}

      <h4>Review findings ({e.reviewFindings.length})</h4>
      {e.reviewFindings.length === 0 ? (
        <p className="empty">No findings.</p>
      ) : (
        <ul className="findings">
          {e.reviewFindings.map((finding) => (
            <li key={finding.id} className={finding.resolved ? "resolved" : ""}>
              <span className={`sev sev-${finding.severity}`}>
                {finding.severity}
              </span>
              <span className="finding-body">{finding.body}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
