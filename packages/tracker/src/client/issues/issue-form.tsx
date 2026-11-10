import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, refresh, type BootstrapData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ErrorNotice, Modal, priorities } from "#client/ui/ui.tsx";
import { MarkdownEditor } from "#client/ui/markdown.tsx";
import { announce } from "#client/shell/announce.tsx";

export function NewIssue({
  open,
  close,
  bootstrap,
  teamKey: currentTeamKey,
  onCreated,
}: {
  open: boolean;
  close: () => void;
  bootstrap: BootstrapData;
  /** The team in view; a new issue starts there unless the form picks another. */
  teamKey: string;
  onCreated: (identifier: string) => void;
}) {
  const [chosenTeam, setTeam] = useState<string>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chosenState, setState] = useState<string>();
  const [priority, setPriority] = useState(0);
  const [projectSlug, setProject] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [attachmentIds, setAttachments] = useState<string[]>([]);
  const teamKey = chosenTeam ?? currentTeamKey;
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const states = bootstrap.states.filter(({ teamId }) => teamId === team?.id);
  // New work lands in the team's triage state unless the form says otherwise.
  const stateName =
    chosenState ??
    (states.find(({ type }) => type === "triage") ?? states[0])?.name;
  const create = useMutation({
    mutationFn: () =>
      api.issues.create.mutate({
        actor: currentActor(),
        teamKey,
        title,
        description,
        ...(stateName === undefined ? {} : { stateName }),
        priority,
        ...(projectSlug === "" ? {} : { projectSlug }),
        labels,
        attachmentIds,
      }),
    onSuccess: (issue) => {
      void refresh();
      setTitle("");
      setDescription("");
      setAttachments([]);
      setTeam(undefined);
      setLabels([]);
      setState(undefined);
      announce(`Issue ${issue.identifier} created`);
      close();
      onCreated(issue.identifier);
    },
  });
  return (
    <Modal title="New issue" open={open} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
      >
        <div className="form-selects">
          <label>
            Team
            <select
              value={teamKey}
              onChange={(e) => {
                setTeam(e.target.value);
                setLabels([]);
                setState(undefined);
              }}
            >
              {bootstrap.teams.map((t) => (
                <option key={t.id} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={stateName}
              onChange={(e) => {
                setState(e.target.value);
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
              value={priority}
              onChange={(e) => {
                setPriority(Number(e.target.value));
              }}
            >
              {priorities.map((p, i) => (
                <option key={p} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="title-input"
          aria-label="Issue title"
          placeholder="Issue title"
          value={title}
          required
          maxLength={500}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <MarkdownEditor
          value={description}
          onChange={setDescription}
          onAttachments={(ids) => {
            setAttachments((previous) => [...previous, ...ids]);
          }}
          placeholder="Add a description…"
          label="Description"
        />
        <div className="form-selects">
          <label>
            Project
            <select
              value={projectSlug}
              onChange={(e) => {
                setProject(e.target.value);
              }}
            >
              <option value="">No project</option>
              {bootstrap.projects
                .filter((p) => p.archivedAt === null)
                .map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset className="label-options">
            <legend>Labels</legend>
            {bootstrap.labels
              .filter(({ teamId }) => teamId === team?.id)
              .map((label) => (
                <label key={label.id}>
                  <input
                    type="checkbox"
                    checked={labels.includes(label.name)}
                    onChange={(e) => {
                      setLabels((previous) =>
                        e.target.checked
                          ? [...previous, label.name]
                          : previous.filter((name) => name !== label.name),
                      );
                    }}
                  />
                  {label.name}
                </label>
              ))}
          </fieldset>
        </div>
        {create.error !== null && <ErrorNotice error={create.error} />}
        <div className="modal-footer">
          <span className="muted">⌘ Enter to create</span>
          <button
            type="submit"
            className="primary"
            disabled={create.isPending || !bootstrap.writesEnabled}
          >
            {create.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
