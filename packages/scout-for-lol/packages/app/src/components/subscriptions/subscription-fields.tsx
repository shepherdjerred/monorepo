import { useState } from "react";
import { formOptions } from "@tanstack/react-form";
import {
  Field,
  FieldDescription,
  FieldError,
  Label,
  FormSection,
} from "@scout-for-lol/design-system/components/input";
import { RiotIdCombobox } from "#src/components/identity/riot-id-combobox.tsx";
import { DiscordMemberCombobox } from "#src/components/identity/discord-member-combobox.tsx";
import { SubscriptionFilterFields } from "#src/components/subscriptions/subscription-filter-fields.tsx";
import {
  fieldErrorMessage,
  withScoutForm,
} from "#src/components/semantic-form.tsx";
import { emptySubscriptionFormValue } from "#src/lib/form-schemas.ts";
import { findRegion, REGIONS, regionLabel } from "#src/lib/domain/regions.ts";

export const subscriptionFormOptions = formOptions({
  defaultValues: emptySubscriptionFormValue(""),
});

type SubscriptionFieldsProps = {
  idPrefix: string;
  guildId: string;
  channels: { id: string; name: string }[];
};

const DEFAULT_SUBSCRIPTION_FIELDS_PROPS: SubscriptionFieldsProps = {
  idPrefix: "subscription",
  guildId: "",
  channels: [],
};

export const SubscriptionFields = withScoutForm({
  ...subscriptionFormOptions,
  props: DEFAULT_SUBSCRIPTION_FIELDS_PROPS,
  render: function SubscriptionFieldsContent(props) {
    const { form, idPrefix, guildId } = props;
    const [regionNotice, setRegionNotice] = useState<string | null>(null);

    return (
      <div className="space-y-5">
        <FormSection
          legend="Destination"
          description="Choose the Discord channel that receives match reports."
        >
          <form.AppField name="channelId">
            {(field) => (
              <field.NativeSelectField
                id={`${idPrefix}-channel`}
                label="Channel"
                placeholder="Pick a channel"
                options={props.channels.map((channel) => ({
                  value: channel.id,
                  label: `#${channel.name}`,
                }))}
                required
              />
            )}
          </form.AppField>
        </FormSection>

        <FormSection
          legend="Player identity"
          description="Identify the League account and how it appears in Scout."
        >
          <form.AppField name="region">
            {(field) => (
              <field.NativeSelectField
                id={`${idPrefix}-region`}
                label="Region"
                options={REGIONS}
                required
              />
            )}
          </form.AppField>
          {regionNotice === null ? null : (
            <p className="text-xs text-scout-subtle" role="status">
              {regionNotice}
            </p>
          )}

          <form.AppField name="riotId">
            {(field) => {
              const error = field.state.meta.isTouched
                ? fieldErrorMessage(field.state.meta.errors)
                : undefined;
              const errorId = `${idPrefix}-riot-id-error`;
              return (
                <Field>
                  <Label htmlFor={`${idPrefix}-riot-id`}>
                    Riot ID{" "}
                    <span className="text-scout-subtle">(name#TAG)</span>
                  </Label>
                  <form.Subscribe selector={(state) => state.values.region}>
                    {(region) => (
                      <RiotIdCombobox
                        id={`${idPrefix}-riot-id`}
                        name={field.name}
                        guildId={guildId}
                        region={region}
                        value={field.state.value}
                        onValueChange={(riotId) => {
                          setRegionNotice(null);
                          field.handleChange(riotId);
                        }}
                        onSelectAccount={({
                          riotId,
                          region: accountRegion,
                        }) => {
                          const match = findRegion(accountRegion);
                          const changed = match !== null && match !== region;
                          setRegionNotice(
                            changed
                              ? `Region set to ${regionLabel(match)} — that's where ${riotId} plays. Change it above if that's not the account you meant.`
                              : null,
                          );
                          field.handleChange(riotId);
                          if (match !== null)
                            form.setFieldValue("region", match);
                        }}
                        placeholder="Search a name or type name#TAG"
                        required
                        {...(error === undefined
                          ? {}
                          : {
                              ariaInvalid: true,
                              ariaDescribedBy: errorId,
                            })}
                      />
                    )}
                  </form.Subscribe>
                  {error === undefined ? null : (
                    <FieldError id={errorId}>{error}</FieldError>
                  )}
                </Field>
              );
            }}
          </form.AppField>

          <form.AppField name="alias">
            {(field) => (
              <field.TextField
                id={`${idPrefix}-alias`}
                label="Player name"
                description="How this person appears in Scout."
                placeholder="Player name"
                autoComplete="off"
                maxLength={100}
                required
              />
            )}
          </form.AppField>

          <form.AppField name="discordUserId">
            {(field) => {
              const error = field.state.meta.isTouched
                ? fieldErrorMessage(field.state.meta.errors)
                : undefined;
              const descriptionId = `${idPrefix}-discord-description`;
              const errorId = `${idPrefix}-discord-error`;
              return (
                <Field>
                  <Label htmlFor={`${idPrefix}-discord`}>
                    Discord user{" "}
                    <span className="text-scout-subtle">(optional)</span>
                  </Label>
                  <DiscordMemberCombobox
                    id={`${idPrefix}-discord`}
                    name={field.name}
                    guildId={guildId}
                    value={field.state.value}
                    onChange={field.handleChange}
                    ariaDescribedBy={
                      error === undefined
                        ? descriptionId
                        : `${descriptionId} ${errorId}`
                    }
                    {...(error === undefined ? {} : { ariaInvalid: true })}
                  />
                  <FieldDescription id={descriptionId}>
                    Links a new player to this Discord user. Existing players
                    keep their current link.
                  </FieldDescription>
                  {error === undefined ? null : (
                    <FieldError id={errorId}>{error}</FieldError>
                  )}
                </Field>
              );
            }}
          </form.AppField>
        </FormSection>

        <FormSection
          legend="Filters"
          description="Limit notifications by queue, or leave empty for every queue."
        >
          <form.AppField name="filters">
            {(field) => (
              <Field>
                <Label htmlFor={`${idPrefix}-queues`}>Notify for</Label>
                <SubscriptionFilterFields
                  id={`${idPrefix}-queues`}
                  name={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.AppField>
        </FormSection>
      </div>
    );
  },
});
