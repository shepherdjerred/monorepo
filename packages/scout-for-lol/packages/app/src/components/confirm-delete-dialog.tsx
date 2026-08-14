import type { ExploreConversation } from "@scout-for-lol/data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { DialogFormFooter } from "#src/components/dialog-form.tsx";

/**
 * Confirm before destroying a conversation.
 *
 * The wider app uses `globalThis.confirm()` for this, but a chat surface where
 * the delete control sits one row away from every conversation deserves a real
 * modal — a mis-click here loses work that cannot be recovered, since deleting
 * a conversation cascades to every branch under it.
 */
export function ConfirmDeleteDialog(props: {
  conversation: ExploreConversation | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (conversation: ExploreConversation) => void;
}) {
  const { conversation } = props;
  return (
    <Dialog
      open={conversation !== null}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (conversation !== null) {
              props.onConfirm(conversation);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              {conversation === null
                ? null
                : `“${conversation.title}” and every branch in it will be removed. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFormFooter
            pending={props.pending ?? false}
            submitLabel="Delete"
            pendingLabel="Deleting…"
            submitVariant="destructive"
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
