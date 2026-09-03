import { useEffect, useRef } from "react";
import {
  EXPLORE_TITLE_MAX_LENGTH,
  type ExploreConversation,
} from "@scout-for-lol/data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import { DialogFormFooter } from "#src/components/dialog-form.tsx";
import {
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ExploreConversationTitleFormSchema } from "#src/lib/form-schemas.ts";

/**
 * Rename a conversation.
 *
 * Titles are derived from the opening question, which is a reasonable default
 * and a poor permanent name once a conversation wanders.
 */
export function RenameConversationDialog(props: {
  conversation: ExploreConversation | null;
  pending?: boolean;
  error?: string | null | undefined;
  onClose: () => void;
  onRename: (conversation: ExploreConversation, title: string) => void;
}) {
  const { conversation } = props;
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { title: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ExploreConversationTitleFormSchema },
    onSubmit: ({ value }) => {
      if (conversation === null) return;
      const parsed = ExploreConversationTitleFormSchema.parse(value);
      props.onRename(conversation, parsed.title);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  // Seed the field each time a different conversation is opened.
  useEffect(() => {
    form.reset({ title: conversation?.title ?? "" });
  }, [conversation, form]);

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
        <form.AppForm>
          <form
            ref={formElement}
            aria-busy={props.pending ?? false}
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename conversation</DialogTitle>
            </DialogHeader>
            <fieldset
              disabled={props.pending ?? false}
              className="m-0 border-0 p-0 py-4"
            >
              <form.AppField name="title">
                {(field) => (
                  <field.TextField
                    id="explore-conversation-title"
                    label="Title"
                    autoComplete="off"
                    maxLength={EXPLORE_TITLE_MAX_LENGTH}
                    required
                  />
                )}
              </form.AppField>
            </fieldset>
            {props.error !== undefined && props.error !== null && (
              <p
                role="alert"
                className="rounded-md border border-scout-danger/40 bg-scout-danger/10 px-3 py-2 text-sm text-scout-danger mb-2"
              >
                {props.error}
              </p>
            )}
            <FormPendingStatus pending={props.pending ?? false}>
              {"Renaming conversation…"}
            </FormPendingStatus>
            <DialogFormFooter
              pending={props.pending ?? false}
              submitLabel="Rename"
              pendingLabel="Renaming…"
              onCancel={() => {
                form.reset({ title: conversation?.title ?? "" });
                props.onClose();
              }}
            />
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
