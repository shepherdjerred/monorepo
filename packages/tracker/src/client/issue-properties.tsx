import { Trash2, ThumbsUp } from "lucide-react";
import { ActorChip, priorities } from "./ui.tsx";
import type { BootstrapData, IssueDetailData } from "./api.ts";
type Props = {
  issue: IssueDetailData;
  bootstrap: BootstrapData;
  disabled: boolean;
  update: (patch: Record<string, unknown>) => void;
  vote: () => void;
  voting: boolean;
  onDelete: () => void;
};
export function IssueProperties({
  issue,
  bootstrap,
  disabled,
  update,
  vote,
  voting,
  onDelete,
}: Props) {
  const states = bootstrap.states.filter(
    ({ teamId }) => teamId === issue.teamId,
  );
  return (
    <aside className="properties">
      <h2>Properties</h2>
      <label>
        Status
        <select
          id="property-state"
          aria-label="Status"
          disabled={disabled}
          value={issue.state.name}
          onChange={(e) => {
            update({ stateName: e.target.value });
          }}
        >
          {states.map((s) => (
            <option key={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          id="property-priority"
          disabled={disabled}
          value={issue.priority}
          onChange={(e) => {
            update({ priority: Number(e.target.value) });
          }}
        >
          {priorities.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select
          id="property-assignee"
          disabled={disabled}
          value={issue.assignee?.key ?? ""}
          onChange={(e) => {
            update({ assigneeKey: e.target.value || null });
          }}
        >
          <option value="">Unassigned</option>
          {bootstrap.actors.map((a) => (
            <option key={a.id} value={a.key}>
              {a.name} · {a.key}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select
          id="property-project"
          disabled={disabled}
          value={issue.project?.slug ?? ""}
          onChange={(e) => {
            update({ projectSlug: e.target.value || null });
          }}
        >
          <option value="">No project</option>
          {bootstrap.projects.map((p) => (
            <option key={p.id} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="property-labels" id="property-labels">
        <legend>Labels</legend>
        {bootstrap.labels
          .filter(({ teamId }) => teamId === issue.teamId)
          .map((label) => (
            <label key={label.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={issue.labels.some(({ id }) => id === label.id)}
                onChange={(e) => {
                  update(
                    e.target.checked
                      ? { addLabels: [label.name] }
                      : { removeLabels: [label.name] },
                  );
                }}
              />
              <i style={{ background: label.color }} />
              {label.name}
            </label>
          ))}
      </fieldset>
      <button
        id="issue-vote"
        className={`vote-button ${issue.viewerVoted ? "voted" : ""}`}
        aria-pressed={issue.viewerVoted}
        disabled={disabled || voting}
        onClick={() => {
          vote();
        }}
      >
        <ThumbsUp size={15} />
        {issue.voteCount} {issue.voteCount === 1 ? "vote" : "votes"}
      </button>
      <div className="created-by">
        <span className="muted">Created by</span>
        <ActorChip actor={issue.creator} />
        <time>{new Date(issue.createdAt).toLocaleDateString()}</time>
      </div>
      {issue.sourceMetadata !== null && (
        <details>
          <summary>Imported metadata</summary>
          <pre>{JSON.stringify(issue.sourceMetadata, null, 2)}</pre>
        </details>
      )}
      <button
        className="text-button danger"
        disabled={disabled}
        onClick={() => {
          onDelete();
        }}
      >
        <Trash2 size={14} />
        Delete issue
      </button>
    </aside>
  );
}
