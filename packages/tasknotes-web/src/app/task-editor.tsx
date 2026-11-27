import type { Task } from "@shepherdjerred/facet-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CivilDay } from "#workspace/civil-day.ts";
import { InspectorForm } from "#workspace/inspector.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import {
  readTaskDraft,
  taskDraftChanges,
  type TaskDraft,
} from "#workspace/task-draft.ts";
import { reportAction } from "./ui-action.ts";
import type { CommandHandler } from "#workspace/workspace-commands.ts";
import { DecisionDialog } from "./workspace-dialog.tsx";
import { workspaceEngine } from "#sync/workspace-engine.ts";
import { activeLabels, activeProjects } from "#workspace/workspace.ts";

type RecoveredDraft = { value: TaskDraft | undefined; warning: string | null };

export function TaskEditor(props: {
  task: Task;
  data: WorkspaceData;
  today: CivilDay;
  timeZone: string;
  onCommand: CommandHandler;
  canWrite: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onToggle: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const id = props.task.id;
  const [draft, setDraft] = useState<RecoveredDraft | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const hasStoredDraft = useRef(false);
  const persistDraft = useCallback(
    (value: TaskDraft | null): void => {
      if (value === null && !hasStoredDraft.current) return;
      hasStoredDraft.current = value !== null;
      void reportAction(
        async () => {
          await (value === null
            ? workspaceEngine.clearDraft(id)
            : workspaceEngine.saveDraft(id, value));
          setStorageError(false);
        },
        () => {
          setStorageError(true);
        },
      );
    },
    [id],
  );
  useEffect(() => {
    let active = true;
    void reportAction(
      async () => {
        const saved = readTaskDraft(await workspaceEngine.getDraft(id));
        if (active) setDraft({ value: saved, warning: null });
      },
      () => {
        if (active)
          setDraft({
            value: undefined,
            warning: "Saved drafts could not be opened.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (draft === null)
    return (
      <p role="status" className="empty">
        Opening task…
      </p>
    );
  return (
    <>
      {draft.warning === null ? null : <p role="status">{draft.warning}</p>}
      {storageError ? (
        <p role="alert">This draft could not be saved on this device.</p>
      ) : null}
      <InspectorForm
        task={props.task}
        data={props.data}
        projects={activeProjects(props.data.projects)}
        labels={activeLabels(props.data.labels)}
        today={props.today}
        timeZone={props.timeZone}
        canWrite={props.canWrite}
        {...(draft.value === undefined ? {} : { initialDraft: draft.value })}
        onDirtyChange={props.onDirtyChange}
        onDraftChange={persistDraft}
        onCommand={props.onCommand}
        onSave={async (values, original) => {
          const changes = taskDraftChanges(
            props.task,
            values,
            props.timeZone,
            original,
          );
          return (
            Object.keys(changes).length === 1 ||
            props.onCommand({ type: "TaskUpdate", args: changes })
          );
        }}
        onClose={props.onClose}
        onToggle={props.onToggle}
        onOpenTask={props.onOpenTask}
        onAskDelete={() => {
          setAskDelete(true);
        }}
        onDownloadAttachment={async (taskId, commentId, filename) => {
          const file = await workspaceEngine.attachment(taskId, commentId);
          const url = URL.createObjectURL(file);
          const download = document.createElement("a");
          download.href = url;
          download.download = filename;
          download.click();
          globalThis.setTimeout(() => {
            URL.revokeObjectURL(url);
          }, 0);
        }}
      />
      {askDelete ? (
        <DecisionDialog
          title="Delete task?"
          detail={props.task.title}
          action="Delete task"
          onDismiss={() => {
            setAskDelete(false);
          }}
          onDecision={() => {
            setAskDelete(false);
            void reportAction(
              async () => {
                if (
                  !(await props.onCommand({ type: "TaskDelete", args: { id } }))
                )
                  return;
                await workspaceEngine.clearDraft(id);
                props.onDirtyChange(false);
                props.onClose();
              },
              () => {
                setStorageError(true);
              },
            );
          }}
        />
      ) : null}
    </>
  );
}
