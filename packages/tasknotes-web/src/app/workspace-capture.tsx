import { useState } from "react";
import { WorkspaceCapture } from "#workspace/capture.tsx";
import type { CivilDay } from "#workspace/civil-day.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import type { CommandHandler } from "#workspace/workspace-commands.ts";
import { WorkspaceDialog } from "./workspace-dialog.tsx";
import type { Destination, TaskGroup } from "#workspace/workspace.ts";

type CaptureTarget = { sectionId?: string; day?: CivilDay };

export function useCapture(options: {
  data: WorkspaceData;
  destination: Destination;
  today: CivilDay;
  timeZone: string;
  selectedDay: CivilDay | null;
  canWrite: boolean;
  onCommand: CommandHandler;
}) {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const { selectedDay, canWrite, ...context } = options;

  function openCapture(selection: CaptureTarget = {}): void {
    if (canWrite) setTarget(selection);
  }

  function captureGroup(group: TaskGroup): void {
    openCapture({
      ...(group.civilDate === undefined ? {} : { day: group.civilDate }),
      ...(group.sectionId === undefined ? {} : { sectionId: group.sectionId }),
    });
  }

  function closeCapture(): void {
    setTarget(null);
  }

  const day = target?.day ?? selectedDay;
  const sectionId = target?.sectionId;
  const captureDialog =
    target === null ? null : (
      <WorkspaceDialog
        title="Quick Add"
        className="capture-dialog"
        onDismiss={closeCapture}
      >
        <WorkspaceCapture
          {...context}
          {...(day === null ? {} : { upcomingDay: day })}
          {...(sectionId === undefined ? {} : { sectionId })}
          onClose={closeCapture}
        />
      </WorkspaceDialog>
    );

  return { openCapture, captureGroup, captureDialog };
}
