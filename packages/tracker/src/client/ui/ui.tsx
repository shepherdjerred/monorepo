import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { priorities } from "#client/data/issue-changes.ts";
import { PriorityGlyph } from "./icons.tsx";
import { leavingPopup } from "./leaving.tsx";

export function Modal({
  title,
  open,
  onClose,
  children,
  className = "",
  pickerScope,
  onEscape,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Pickers opened inside render in the host with this scope. */
  pickerScope?: string;
  /** Handle Escape first; returning true keeps the dialog open. */
  onEscape?: () => boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value, details) => {
        if (value) return;
        if (details.reason === "escape-key" && onEscape?.() === true) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          render={leavingPopup}
          className={`modal ${className}`}
          data-picker-scope={pickerScope}
        >
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

/** `decorative` hides the image from assistive technology when the name is adjacent. */
export function Avatar({
  actor,
  decorative = false,
}: {
  actor: { key: string; name: string };
  decorative?: boolean;
}) {
  return (
    <img
      className="avatar"
      src={`/avatars/${encodeURIComponent(actor.key)}.svg`}
      alt={decorative ? "" : actor.name}
      title={actor.name}
      width={22}
      height={22}
    />
  );
}
export function Swatch({ color }: { color: string }) {
  return (
    <span className="swatch" style={{ background: color }} aria-hidden="true" />
  );
}
export function ActorChip({
  actor,
}: {
  actor: { key: string; name: string; kind: string };
}) {
  return (
    <span className="actor-chip">
      <Avatar actor={actor} decorative />
      <span>{actor.name}</span>
      <span className="kind">{actor.kind}</span>
    </span>
  );
}
export function Priority({ value }: { value: number }) {
  return (
    <span
      className={`priority priority-${String(value)}`}
      role="img"
      title={priorities[value]}
      aria-label={priorities[value]}
    >
      <PriorityGlyph value={value} />
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
      <span className="empty-icon" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
