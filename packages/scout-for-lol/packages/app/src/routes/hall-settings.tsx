import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { HallSettingsSchema } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  FormPendingStatus,
  ServerFormError,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { useGuildParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

function toggleValue(
  values: readonly string[],
  value: string,
  checked: boolean,
) {
  return checked
    ? [...values, value]
    : values.filter((candidate) => candidate !== value);
}

export function HallSettings() {
  const { guildId } = useGuildParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useQuery(trpc.hall.getSettings.queryOptions({ guildId }));
  const channels = useQuery(trpc.guild.listChannels.queryOptions({ guildId }));
  const hall = useQuery(trpc.hall.get.queryOptions({ guildId }));
  const update = useMutation(
    trpc.hall.updateSettings.mutationOptions({
      onSuccess: (result) => {
        setError(null);
        queryClient.setQueryData(
          trpc.hall.getSettings.queryKey({ guildId }),
          result.settings,
        );
        void queryClient.invalidateQueries({
          queryKey: trpc.hall.get.queryKey({ guildId }),
        });
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const baseline = useMutation(
    trpc.hall.startBaseline.mutationOptions({
      onSuccess: () => {
        setError(null);
        void queryClient.invalidateQueries({
          queryKey: trpc.hall.get.queryKey({ guildId }),
        });
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: {
      channelId: "",
      enabledQueueFamilies: new Array<string>(),
      enabledRecords: new Array<string>(),
    },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      const parsed = HallSettingsSchema.parse({
        guildId,
        catalogVersion: hall.data?.catalog.version ?? 1,
        channelId: value.channelId.length === 0 ? null : value.channelId,
        enabledQueueFamilies: value.enabledQueueFamilies,
        enabledRecords: value.enabledRecords,
      });
      update.mutate(parsed);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  useEffect(() => {
    if (settings.data === undefined) return;
    form.reset({
      channelId: settings.data.channelId ?? "",
      enabledQueueFamilies: [...settings.data.enabledQueueFamilies],
      enabledRecords: [...settings.data.enabledRecords],
    });
  }, [form, settings.data]);

  if (settings.isPending || hall.isPending) {
    return <p className="text-sm text-scout-subtle">Loading Hall settings…</p>;
  }
  if (settings.isError || hall.isError) {
    return (
      <p className="text-sm text-scout-danger">
        {settings.error?.message ?? hall.error?.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Hall of Fame</h2>
          <p className="mt-1 text-sm text-scout-subtle">
            Each newly enabled queue and record is baselined from Scout-known
            history before record-break notifications begin.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/halls/${guildId}`}>View member Hall</Link>
        </Button>
      </div>

      <form
        ref={formElement}
        className="space-y-5"
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <fieldset disabled={update.isPending} className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Announcements</CardTitle>
              <CardDescription>
                Baselines are silent. Later record breaks are combined into one
                message per match.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {channels.isPending ? (
                <p className="text-sm text-scout-subtle">
                  Loading announcement channels…
                </p>
              ) : (
                <form.Field name="channelId">
                  {(field) => (
                    <label
                      className="grid max-w-md gap-2 text-sm"
                      htmlFor="hall-channel"
                    >
                      <span className="font-medium">Hall channel</span>
                      <select
                        id="hall-channel"
                        name={field.name}
                        className="scout-control"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                      >
                        <option value="">No announcements</option>
                        {channels.isError && field.state.value.length > 0 ? (
                          <option value={field.state.value}>
                            Keep current channel
                          </option>
                        ) : null}
                        {channels.data?.map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            #{channel.name}
                          </option>
                        ))}
                      </select>
                      {channels.isError ? (
                        <span className="text-scout-subtle">
                          Channel choices require channel access. You may keep
                          the current channel or disable announcements.
                        </span>
                      ) : null}
                    </label>
                  )}
                </form.Field>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Queue families</CardTitle>
            </CardHeader>
            <CardContent>
              <form.Field name="enabledQueueFamilies">
                {(field) => (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {hall.data.catalog.hall.queueFamilies.map((family) => (
                      <label
                        key={family.id}
                        className="flex gap-3 rounded-md border p-3 text-sm"
                      >
                        <span className="sr-only">Enable queue family</span>
                        <input
                          type="checkbox"
                          name={field.name}
                          value={family.id}
                          checked={field.state.value.includes(family.id)}
                          onChange={(event) => {
                            field.handleChange(
                              toggleValue(
                                field.state.value,
                                family.id,
                                event.currentTarget.checked,
                              ),
                            );
                          }}
                        />
                        <span>
                          <strong>{family.label}</strong>
                          <span className="block text-scout-subtle">
                            {family.queues.join(" · ")}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Records</CardTitle>
            </CardHeader>
            <CardContent>
              <form.Field name="enabledRecords">
                {(field) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {hall.data.catalog.hall.records.map((record) => (
                      <label
                        key={record.id}
                        className="flex items-center gap-2 rounded-md border p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          name={field.name}
                          value={record.id}
                          checked={field.state.value.includes(record.id)}
                          onChange={(event) => {
                            field.handleChange(
                              toggleValue(
                                field.state.value,
                                record.id,
                                event.currentTarget.checked,
                              ),
                            );
                          }}
                        />
                        {record.label}
                      </label>
                    ))}
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>
        </fieldset>

        <ServerFormError error={error} />
        <FormPendingStatus pending={update.isPending}>
          Saving Hall settings…
        </FormPendingStatus>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={update.isPending}>
            Save settings
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={baseline.isPending}
            onClick={() => {
              baseline.mutate({ guildId });
            }}
          >
            Rebuild all baselines
          </Button>
        </div>
      </form>
    </div>
  );
}
