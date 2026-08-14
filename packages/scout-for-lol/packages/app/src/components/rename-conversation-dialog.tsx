import { useEffect, useState } from "react";
import {
  EXPLORE_TITLE_MAX_LENGTH,
  type ExploreConversation,
} from "@scout-for-lol/data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#src/components/ui/dialog.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { DialogFormFooter } from "#src/components/dialog-form.tsx";

/**
 * Rename a conversation.
 *
 * Titles are derived from the opening question, which is a reasonable default
 * and a poor permanent name once a conversation wanders.
 */
export function RenameConversationDialog(props: {
  conversation: ExploreConversation | null;
  pending?: boolean;
  onClose: () => void;
  onRename: (conversation: ExploreConversation, title: string) => void;
}) {
  const { conversation } = props;
  const [title, setTitle] = useState("");

  // Seed the field each time a different conversation is opened.
  useEffect(() => {
    setTitle(conversation?.title ?? "");
  }, [conversation]);

  const trimmed = title.trim();

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
            if (conversation !== null && trimmed.length > 0) {
              props.onRename(conversation, trimmed);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="explore-conversation-title">Title</Label>
            <Input
              id="explore-conversation-title"
              value={title}
              maxLength={EXPLORE_TITLE_MAX_LENGTH}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>
          <DialogFormFooter
            pending={props.pending ?? false}
            submitLabel="Rename"
            pendingLabel="Renaming…"
            submitDisabled={trimmed.length === 0}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
