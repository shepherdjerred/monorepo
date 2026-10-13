import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({
  title,
  open,
  onClose,
  children,
  className = "",
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className={`modal ${className}`}>
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Avatar({ actor }: { actor: { key: string; name: string } }) {
  return (
    <img
      className="avatar"
      src={`/avatars/${encodeURIComponent(actor.key)}.svg`}
      alt={actor.name}
      title={actor.name}
    />
  );
}
export function ActorChip({
  actor,
}: {
  actor: { key: string; name: string; kind: string };
}) {
  return (
    <span className="actor-chip">
      <Avatar actor={actor} />
      <span>{actor.name}</span>
      <span className="kind">{actor.kind}</span>
    </span>
  );
}
export function StateDot({ color }: { color: string }) {
  return (
    <span className="state-dot" style={{ color }} aria-hidden="true">
      ◉
    </span>
  );
}
export const priorities = ["No priority", "Urgent", "High", "Medium", "Low"];
export function Priority({ value }: { value: number }) {
  return (
    <span
      className={`priority priority-${String(value)}`}
      title={priorities[value]}
      aria-label={priorities[value]}
    >
      {["—", "!", "▰", "▰", "▱"][value]}
    </span>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="error" role="alert">
      {error instanceof Error ? error.message : "Something went wrong"}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">◇</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function timeAgo(value: string) {
  const days = Math.floor(
    (Date.now() - new Date(value).getTime()) / 86_400_000,
  );
  return days < 1 ? "Today" : days === 1 ? "Yesterday" : `${String(days)}d ago`;
}
