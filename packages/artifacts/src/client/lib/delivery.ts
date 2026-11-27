import type {
  ThreadComment,
  ThreadView,
} from "@shepherdjerred/artifacts/procedures";
import type { ActorRef } from "@shepherdjerred/artifacts/contract";

export type ChipTone = "queued" | "sent" | "done";
export type DeliveryChip = {
  readonly label: string;
  readonly tone: ChipTone;
  readonly canRedeliver: boolean;
};

/**
 * Where a human comment is on its way to an agent: Queued, then Sent and
 * Delivered to the actor that claimed it, then Replied or Addressed in vN.
 * Agent comments carry no delivery and no chip.
 */
export function deliveryChip(
  comment: ThreadComment,
  thread: ThreadView,
  currentVersion: number | null,
): DeliveryChip | null {
  const { delivery } = comment;
  if (delivery === null) return null;
  const actor = delivery.actor?.name ?? "agent";
  switch (delivery.state) {
    case "queued":
      return { label: "Queued", tone: "queued", canRedeliver: false };
    case "claimed":
      return { label: `Sent to ${actor}`, tone: "sent", canRedeliver: true };
    case "delivered":
      return {
        label: `Delivered to ${actor}`,
        tone: "sent",
        canRedeliver: true,
      };
    case "handled": {
      const replied = thread.comments.some(
        (other) =>
          other.author.kind !== "human" &&
          Date.parse(other.createdAt) >= Date.parse(comment.createdAt),
      );
      if (replied)
        return { label: "Replied", tone: "done", canRedeliver: false };
      const newer =
        currentVersion !== null &&
        thread.versionNumber !== null &&
        currentVersion > thread.versionNumber;
      return {
        label: newer ? `Addressed in v${String(currentVersion)}` : "Handled",
        tone: "done",
        canRedeliver: false,
      };
    }
  }
}

/** The header line: who is waiting, or how much is queued with nobody to read it. */
export function waitingLine(
  waiters: readonly { readonly actor: ActorRef }[],
  queued: number,
): string {
  const [first] = waiters;
  if (first !== undefined) {
    const others = waiters.length - 1;
    return others === 0
      ? `${first.actor.name} waiting`
      : `${first.actor.name} and ${String(others)} more waiting`;
  }
  return queued > 0
    ? `No agent waiting · ${String(queued)} queued`
    : "No agent waiting";
}

/** A human comment its author may still edit or delete. */
export function isEditable(
  comment: ThreadComment,
  now: number = Date.now(),
): boolean {
  return (
    comment.author.kind === "human" &&
    comment.editableUntil !== null &&
    Date.parse(comment.editableUntil) > now &&
    comment.delivery?.state === "queued"
  );
}
