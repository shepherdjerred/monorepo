import type { Session, SessionHealthReport } from "@clauderon/client";
import { toast } from "sonner";
import { RecreateConfirmModal } from "./RecreateConfirmModal.tsx";

type RecreateModalWrapperProps = {
  session: Session;
  healthReport: SessionHealthReport;
  onOpenChange: (open: boolean) => void;
  startSession: (id: string) => Promise<void>;
  wakeSession: (id: string) => Promise<void>;
  recreateSession: (id: string) => Promise<void>;
  refreshSession: (id: string) => Promise<void>;
  cleanupSession: (id: string) => Promise<void>;
};

async function toastAction(
  promise: Promise<void>,
  sessionName: string,
  successMsg: string,
  errorPrefix: string,
) {
  try {
    await promise;
    toast.success(`Session "${sessionName}" ${successMsg}`);
  } catch (error: unknown) {
    toast.error(
      `Failed to ${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function RecreateModalWrapper({
  session,
  healthReport,
  onOpenChange,
  startSession,
  wakeSession,
  recreateSession,
  refreshSession,
  cleanupSession,
}: RecreateModalWrapperProps) {
  return (
    <RecreateConfirmModal
      open={true}
      onOpenChange={onOpenChange}
      session={session}
      healthReport={healthReport}
      onStart={() => {
        void toastAction(startSession(session.id), session.name, "started", "start");
      }}
      onWake={() => {
        void toastAction(
          wakeSession(session.id),
          session.name,
          "is waking up",
          "wake",
        );
      }}
      onRecreate={() => {
        void toastAction(
          recreateSession(session.id),
          session.name,
          "is being recreated",
          "recreate",
        );
      }}
      onRecreateFresh={() => {
        void toastAction(
          recreateSession(session.id),
          session.name,
          "is being recreated fresh",
          "recreate fresh",
        );
      }}
      onUpdateImage={() => {
        void toastAction(
          refreshSession(session.id),
          session.name,
          "is being refreshed with latest image",
          "update image",
        );
      }}
      onCleanup={() => {
        void toastAction(
          cleanupSession(session.id),
          session.name,
          "cleaned up",
          "cleanup",
        );
      }}
    />
  );
}
