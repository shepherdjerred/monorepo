import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { PlayerAliasFormSchema } from "#src/lib/form-schemas.ts";

export function RenamePlayerDialog(props: {
  guildId: string;
  currentAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (newAlias: string) => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const mutation = useMutation(
    trpc.player.renamePlayer.mutationOptions({
      meta: analyticsMeta("player_renamed"),
      onSuccess: (result) => {
        props.onRenamed(result.alias);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  const form = useScoutForm({
    defaultValues: { alias: props.currentAlias },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: PlayerAliasFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = PlayerAliasFormSchema.parse(value);
      mutation.mutate({
        guildId: props.guildId,
        currentAlias: props.currentAlias,
        newAlias: parsed.alias,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (props.open) form.reset({ alias: props.currentAlias });
  }, [form, props.currentAlias, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Rename player"
          description={<>Rename &quot;{props.currentAlias}&quot;.</>}
          pending={mutation.isPending}
          pendingStatus="Renaming player…"
          error={error}
          submitLabel="Rename"
          pendingLabel="Renaming…"
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            setError(null);
            form.reset({ alias: props.currentAlias });
            props.onOpenChange(false);
          }}
        >
          <form.AppField name="alias">
            {(field) => (
              <field.TextField
                id="rename-player-new"
                label="New player name"
                autoComplete="off"
                maxLength={100}
                required
              />
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
