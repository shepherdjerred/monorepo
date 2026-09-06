import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { DiscordMemberCombobox } from "#src/components/identity/discord-member-combobox.tsx";
import { Dialog } from "@scout-for-lol/design-system/components/dialog";
import {
  Field,
  FieldError,
  Label,
} from "@scout-for-lol/design-system/components/input";
import { SemanticDialogForm } from "#src/components/dialog-form.tsx";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { DiscordUserFormSchema } from "#src/lib/form-schemas.ts";

/** Link a Discord user to a player (via `player.linkDiscord`). */
export function LinkDiscordDialog(props: {
  guildId: string;
  playerAlias: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const trpc = useTRPC();
  const [error, setError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const mutation = useMutation(
    trpc.player.linkDiscord.mutationOptions({
      meta: analyticsMeta("player_discord_linked"),
      onSuccess: () => {
        props.onLinked();
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: { discordUserId: "" },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: DiscordUserFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      const parsed = DiscordUserFormSchema.parse(value);
      mutation.mutate({
        guildId: props.guildId,
        playerAlias: props.playerAlias,
        discordUserId: parsed.discordUserId,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (props.open) form.reset({ discordUserId: "" });
  }, [form, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Link Discord user"
          description={
            <>Link a Discord user to &quot;{props.playerAlias}&quot;.</>
          }
          pending={mutation.isPending}
          pendingStatus="Linking Discord user…"
          error={error}
          submitLabel="Link"
          pendingLabel="Linking…"
          onSubmit={() => form.handleSubmit()}
          onCancel={() => {
            setError(null);
            form.reset({ discordUserId: "" });
            props.onOpenChange(false);
          }}
        >
          <form.AppField name="discordUserId">
            {(field) => {
              const message = field.state.meta.isTouched
                ? fieldErrorMessage(field.state.meta.errors)
                : undefined;
              return (
                <Field>
                  <Label htmlFor="link-discord-dialog-user">Discord user</Label>
                  <DiscordMemberCombobox
                    id="link-discord-dialog-user"
                    name={field.name}
                    guildId={props.guildId}
                    value={field.state.value}
                    onChange={field.handleChange}
                    required
                    ariaInvalid={message !== undefined}
                    {...(message === undefined
                      ? {}
                      : {
                          ariaDescribedBy: "link-discord-dialog-user-error",
                        })}
                  />
                  {message === undefined ? null : (
                    <FieldError id="link-discord-dialog-user-error">
                      {message}
                    </FieldError>
                  )}
                </Field>
              );
            }}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}
