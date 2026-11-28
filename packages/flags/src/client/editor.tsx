import { useId, useRef, useState, type SubmitEvent } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router";
import { z } from "zod";
import { Button, Tabs } from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type { VariantEncoding } from "@shepherdjerred/feature-flags/flag-value-spec.ts";
import { ConflictBanner } from "./conflict-banner.tsx";
import { DiffView, JsonEditor } from "./code.tsx";
import { useApplyFlag, type DeploymentDocument } from "./api.ts";
import { BooleanFields, VariantFields } from "./fields.tsx";
import { useRefreshFlagAudit } from "./management-api.ts";
import {
  applyJsonText,
  defaultEditMode,
  draftError,
  issuePathLabel,
  issuesForKey,
  jsonSchemaFor,
  jsonText,
  reviewText,
  sameFlag,
  valueIssues,
  valueKind,
  type EditMode,
  type EditorIssue,
  type ValueKind,
} from "./model.ts";
import { FlagMeta } from "./views/flag-meta.tsx";
import { HistoryPanel } from "./views/history-panel.tsx";
import { UsagePanel } from "./views/usage-panel.tsx";

const MODES = [
  { value: "form", label: "Form" },
  { value: "json", label: "JSON" },
] as const;

/**
 * The JSON-mode text and what it says. `forDraft` is the draft the text
 * describes: while it is still the draft, switching modes keeps the text
 * (even unparseable text); once the form changes the draft, the text is
 * rebuilt from it.
 */
type JsonState = {
  readonly text: string;
  readonly forDraft: FlagValue | undefined;
  readonly issues: readonly EditorIssue[];
};

/** The server's 400 issues for a submitted draft; shown until the draft changes. */
type ServerIssues = {
  readonly forDraft: FlagValue;
  readonly issues: readonly EditorIssue[];
};

export function Editor({
  catalog,
  stage,
  flagKey,
  document,
  backTo,
}: {
  catalog: string;
  stage: string;
  flagKey: string;
  document: DeploymentDocument;
  /** The deployment's list, with the active search, for the "All flags" link. */
  backTo: string;
}) {
  const stored = document.flags.find((flag) => flag.key === flagKey);
  const [draft, setDraft] = useState<FlagValue | undefined>(stored);
  const [baseFlag, setBaseFlag] = useState<FlagValue | undefined>(stored);
  const [revision, setRevision] = useState(document.revision);
  const [mode, setMode] = useState<EditMode>(() =>
    stored === undefined ? "form" : defaultEditMode(stored),
  );
  const [json, setJson] = useState<JsonState>(() => ({
    text: stored === undefined ? "" : jsonText(stored),
    forDraft: stored,
    issues: [],
  }));
  const [serverIssues, setServerIssues] = useState<ServerIssues | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<
    | { readonly revision: number; readonly flag: FlagValue | undefined }
    | undefined
  >(undefined);
  const [saved, setSaved] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const issuesId = useId();
  const apply = useApplyFlag(catalog, stage);
  const refreshAudit = useRefreshFlagAudit(catalog, stage, flagKey);

  if (stored === undefined || draft === undefined || baseFlag === undefined) {
    return <p role="alert">FLAG_NOT_FOUND</p>;
  }
  if (draft.type !== stored.type || baseFlag.type !== stored.type) {
    return <p role="alert">Stored flag {flagKey} changed type.</p>;
  }

  const kind = valueKind(draft);
  const textIssues = mode === "json" ? json.issues : [];
  // While the JSON text does not parse, the draft is its last good value, so
  // only the text's own issues apply.
  const registryIssues = textIssues.length > 0 ? [] : valueIssues(draft);
  const refused = serverIssues?.forDraft === draft ? serverIssues.issues : [];
  const issues = [...textIssues, ...registryIssues, ...refused];
  const blocked = textIssues.length > 0 || registryIssues.length > 0;
  const modelPath = [catalog, stage, flagKey]
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  function edit(next: FlagValue) {
    setDraft(next);
    setSaved(false);
  }

  function chooseMode(next: EditMode) {
    if (draft === undefined) return;
    if (next === "json" && json.forDraft !== draft) {
      setJson({ text: jsonText(draft), forDraft: draft, issues: [] });
    }
    setMode(next);
  }

  function editJson(text: string) {
    if (draft === undefined) return;
    const result = applyJsonText(draft, text);
    if (result.ok) {
      edit(result.flag);
      setJson({ text, forDraft: result.flag, issues: [] });
    } else {
      setJson({ text, forDraft: draft, issues: result.issues });
      setSaved(false);
    }
  }

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === undefined || blocked) return;
    const problem = draftError(draft);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    if (baseFlag !== undefined && sameFlag(draft, baseFlag)) {
      setError("Nothing to save");
      return;
    }
    setError(undefined);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      setReviewing(true);
      dialog.showModal();
    }
  }

  function confirmSave() {
    const dialog = dialogRef.current;
    // Save only from an open review of a savable draft: the same checks as
    // Review, so a stray click on a closed dialog never writes.
    const reviewed = dialog?.open === true;
    dialog?.close();
    if (blocked || !reviewed || draft === undefined || saving.current) return;
    if (draftError(draft) !== undefined) return;
    if (baseFlag !== undefined && sameFlag(draft, baseFlag)) return;
    void save(draft);
  }

  function cancelReview() {
    dialogRef.current?.close();
  }

  async function save(flag: FlagValue) {
    saving.current = true;
    try {
      const result = await apply.mutateAsync({
        expectedRevision: revision,
        flag,
      });
      if (result.kind === "conflict") {
        refreshAudit();
        setSaved(false);
        setConflict({
          revision: result.revision,
          flag: result.flags.find((candidate) => candidate.key === flag.key),
        });
        return;
      }
      if (result.kind === "invalid") {
        setSaved(false);
        setServerIssues({
          forDraft: flag,
          issues: issuesForKey(result.issues, flag.key),
        });
        setError(`The server refused this value: ${result.error}`);
        return;
      }
      refreshAudit();
      setConflict(undefined);
      setServerIssues(undefined);
      setError(undefined);
      setRevision(result.revision);
      setBaseFlag(flag);
      setSaved(true);
    } catch (error_: unknown) {
      const parsed = z.object({ message: z.string() }).safeParse(error_);
      setError(parsed.success ? parsed.data.message : "Save failed");
    } finally {
      saving.current = false;
    }
  }

  function loadTheirs() {
    if (conflict?.flag === undefined) return;
    setDraft(conflict.flag);
    setBaseFlag(conflict.flag);
    setJson({
      text: jsonText(conflict.flag),
      forDraft: conflict.flag,
      issues: [],
    });
    setRevision(conflict.revision);
    setConflict(undefined);
    setServerIssues(undefined);
    setSaved(false);
    setError(undefined);
  }

  /** An old version from the history becomes the draft, for the usual review. */
  function restore(flag: FlagValue) {
    edit(flag);
    setJson({ text: jsonText(flag), forDraft: flag, issues: [] });
    setError(undefined);
  }

  const describedBy = issues.length === 0 ? undefined : issuesId;

  return (
    <section className="fl-detail" aria-labelledby="flag-heading">
      <div className="fl-detail-head">
        <Link className="fl-back" to={backTo}>
          <ArrowLeftIcon aria-hidden="true" />
          All flags
        </Link>
        <h2 id="flag-heading" className="ui-mono fl-detail-title">
          {flagKey}
        </h2>
        <p className="ui-muted">
          {kindLabel(kind)} · Revision {revision}
        </p>
        <FlagMeta catalog={catalog} stage={stage} flagKey={flagKey} />
      </div>
      {conflict === undefined ? null : (
        <ConflictBanner
          revision={conflict.revision}
          theirs={conflict.flag}
          draft={draft}
          onLoadTheirs={loadTheirs}
        />
      )}
      {kind.kind === "unmanaged" ? (
        <p className="fl-notice" role="note">
          This key is not in the value registry, so its value is shown as plain
          text. The server rejects writes to unmanaged keys.
        </p>
      ) : null}
      <form className="fl-form" onSubmit={review}>
        <div className="fl-mode">
          <Tabs
            label="Edit as"
            options={MODES}
            value={mode}
            onChange={chooseMode}
          />
        </div>
        {mode === "json" ? (
          <div className="fl-json">
            <span className="fl-json-label">{jsonLabel(kind)}</span>
            <JsonEditor
              value={json.text}
              onChange={editJson}
              schema={jsonSchemaFor(draft)}
              modelPath={modelPath}
              label={`${flagKey} ${jsonLabel(kind)}`}
              describedBy={describedBy}
              invalid={blocked}
            />
          </div>
        ) : draft.type === "boolean" ? (
          <BooleanFields flag={draft} onChange={edit} />
        ) : (
          <VariantFields
            flag={draft}
            kind={kind}
            onChange={edit}
            describedBy={describedBy}
            invalid={blocked}
          />
        )}
        <IssueList id={issuesId} issues={issues} />
        {error === undefined ? null : (
          <p role="alert" className="ui-field-error">
            {error}
          </p>
        )}
        {saved ? (
          <p role="status" className="ui-muted">
            Saved.
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={blocked}
            aria-describedby={blocked ? issuesId : undefined}
          >
            Review save
          </Button>
        </div>
      </form>
      <UsagePanel catalog={catalog} stage={stage} flagKey={flagKey} />
      <HistoryPanel
        catalog={catalog}
        stage={stage}
        flagKey={flagKey}
        restore={{ stored: baseFlag, onRestore: restore }}
      />
      <dialog
        ref={dialogRef}
        className="fl-dialog"
        aria-labelledby="save-title"
        onClose={() => {
          setReviewing(false);
        }}
      >
        <h2 id="save-title" className="fl-dialog-title">
          Save <span className="ui-mono">{flagKey}</span>
        </h2>
        <p className="ui-muted fl-dialog-legend">
          The value stored at revision {revision} (before) against your draft
          (after).
        </p>
        {reviewing ? (
          <DiffView
            original={reviewText(baseFlag)}
            modified={reviewText(draft)}
            labels={{ original: "Stored", modified: "Draft" }}
          />
        ) : null}
        <div className="fl-dialog-actions">
          <Button
            type="button"
            value="cancel"
            onClick={cancelReview}
            // The native dialog focuses the safe action when it opens.
            ref={(element: HTMLButtonElement | null) => {
              element?.setAttribute("autofocus", "");
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            value="save"
            variant="primary"
            onClick={confirmSave}
          >
            Save
          </Button>
        </div>
      </dialog>
    </section>
  );
}

const JSON_LABELS: Readonly<Record<VariantEncoding, string>> = {
  json: "Value JSON",
  number: "Value (JSON number)",
  string: "Value (JSON string)",
};

/** Unmanaged variants are plain strings to the editor. */
function encodingOf(kind: ValueKind): VariantEncoding {
  return kind.kind === "managed" ? kind.encoding : "string";
}

function kindLabel(kind: ValueKind): string {
  return kind.kind === "boolean"
    ? "boolean flag"
    : `variant flag · ${kind.kind === "managed" ? kind.encoding : "unmanaged"}`;
}

function jsonLabel(kind: ValueKind): string {
  return kind.kind === "boolean" ? "Flag JSON" : JSON_LABELS[encodingOf(kind)];
}

/** The draft's problems, one per path, kept live so screen readers hear changes. */
function IssueList({
  id,
  issues,
}: {
  id: string;
  issues: readonly EditorIssue[];
}) {
  return (
    <ul id={id} className="fl-issues" aria-live="polite">
      {issues.map((issue, index) => (
        <li key={`${issue.path}:${String(index)}`}>
          <code className="ui-mono">{issuePathLabel(issue.path)}</code>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
