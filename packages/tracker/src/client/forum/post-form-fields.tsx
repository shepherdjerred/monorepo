import { X } from "lucide-react";
import { ForumKindSchema, type ForumKind } from "#shared/forum.ts";
import { IssueSearchCombobox } from "#client/controls/issue-search.tsx";
import type { BootstrapData } from "#client/data/api.ts";
import { expiryPresets, presetLocalDateTime } from "./data.ts";

export function NoticeFields({
  baseId,
  actor,
  actors,
  condition,
  setCondition,
  ownerKey,
  setOwnerKey,
  localExpires,
  setLocalExpires,
}: {
  baseId: string;
  actor: { key: string; name: string };
  actors: BootstrapData["actors"];
  condition: string;
  setCondition: (value: string) => void;
  ownerKey: string;
  setOwnerKey: (value: string) => void;
  localExpires: string;
  setLocalExpires: (value: string) => void;
}) {
  const otherActors = actors.filter((candidate) => candidate.key !== actor.key);
  return (
    <>
      <label htmlFor={`${baseId}-condition`}>
        Exit condition
        <textarea
          id={`${baseId}-condition`}
          required
          value={condition}
          placeholder="What evidence confirms this notice can be resolved?"
          onChange={(event) => {
            setCondition(event.target.value);
          }}
        />
      </label>
      <div className="form-selects">
        <label htmlFor={`${baseId}-owner`}>
          Owner
          <select
            id={`${baseId}-owner`}
            value={ownerKey}
            onChange={(event) => {
              setOwnerKey(event.target.value);
            }}
          >
            <option value="">Unclaimed</option>
            <option value={actor.key}>
              Me ({actor.name} · {actor.key})
            </option>
            {otherActors.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.name} ({candidate.key})
              </option>
            ))}
          </select>
        </label>
        <div className="forum-expiry-field">
          <label htmlFor={`${baseId}-expires`}>
            Expires at
            <input
              id={`${baseId}-expires`}
              type="datetime-local"
              value={localExpires}
              aria-describedby={`${baseId}-expires-hint`}
              onChange={(event) => {
                setLocalExpires(event.target.value);
              }}
            />
          </label>
          <div className="forum-preset-row">
            {expiryPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="forum-preset-btn"
                onClick={() => {
                  setLocalExpires(presetLocalDateTime(preset.hours));
                }}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className="forum-preset-btn"
              onClick={() => {
                setLocalExpires("");
              }}
            >
              Clear
            </button>
          </div>
          <p id={`${baseId}-expires-hint`} className="muted">
            Expiration hides this notice from the active feed; it does not
            confirm cleanup.
          </p>
        </div>
      </div>
    </>
  );
}

export function LinkedIssuesField({
  baseId,
  linkedIssues,
  setLinkedIssues,
  issueInput,
  setIssueInput,
}: {
  baseId: string;
  linkedIssues: readonly string[];
  setLinkedIssues: (next: string[]) => void;
  issueInput: string;
  setIssueInput: (value: string) => void;
}) {
  function addIdentifier(identifier: string) {
    const normalized = identifier.trim().toUpperCase();
    if (!linkedIssues.includes(normalized)) {
      setLinkedIssues([...linkedIssues, normalized]);
    }
  }
  return (
    <div className="forum-field-block">
      <label htmlFor={`${baseId}-linked-issues`}>Linked issues</label>
      {linkedIssues.length > 0 && (
        <div className="forum-chip-row">
          {linkedIssues.map((identifier) => (
            <span key={identifier} className="property-chip">
              <span className="identifier">{identifier}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${identifier}`}
                onClick={() => {
                  setLinkedIssues(
                    linkedIssues.filter((item) => item !== identifier),
                  );
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <IssueSearchCombobox
        id={`${baseId}-linked-issues`}
        label="Linked issues"
        placeholder="Search or type AI-42…"
        value={issueInput}
        onValueChange={setIssueInput}
        exclude={linkedIssues}
        onPick={(identifier) => {
          addIdentifier(identifier);
          setIssueInput("");
        }}
      />
    </div>
  );
}

export function KindAndProjectSelects({
  baseId,
  isCreate,
  kind,
  setKind,
  projectSlug,
  setProjectSlug,
  projects,
}: {
  baseId: string;
  isCreate: boolean;
  kind: ForumKind;
  setKind: (kind: ForumKind) => void;
  projectSlug: string;
  setProjectSlug: (slug: string) => void;
  projects: BootstrapData["projects"];
}) {
  const activeProjects = projects.filter(
    ({ archivedAt }) => archivedAt === null,
  );
  return (
    <div className="form-selects">
      {isCreate && (
        <label htmlFor={`${baseId}-kind`}>
          Post type
          <select
            id={`${baseId}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(ForumKindSchema.parse(event.target.value));
            }}
          >
            <option value="notice">Notice</option>
            <option value="discussion">Discussion</option>
            <option value="question">Question</option>
            <option value="decision">Decision</option>
          </select>
        </label>
      )}
      <label htmlFor={`${baseId}-project`}>
        Project
        <select
          id={`${baseId}-project`}
          value={projectSlug}
          onChange={(event) => {
            setProjectSlug(event.target.value);
          }}
        >
          <option value="">No project</option>
          {activeProjects.map((project) => (
            <option key={project.id} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
