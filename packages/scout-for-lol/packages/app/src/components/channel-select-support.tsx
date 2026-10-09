import type { DiscordChannelId } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import type { ReactNode } from "react";

export type DiscordChannel = { id: DiscordChannelId; name: string };

export type ChannelAvailability = {
  status: "loading" | "error" | "empty" | "ready";
  message?: string;
};

export function channelAvailabilityForQuery(query: {
  isPending: boolean;
  error: { message: string } | null;
  data: DiscordChannel[] | undefined;
}): ChannelAvailability {
  return query.isPending
    ? { status: "loading" }
    : query.error === null
      ? query.data === undefined || query.data.length === 0
        ? { status: "empty" }
        : { status: "ready" }
      : { status: "error", message: query.error.message };
}

export function channelSelectOptions(
  currentChannelId: string,
  channels: readonly DiscordChannel[],
) {
  const options = channels.map((channel) => ({
    value: channel.id,
    label: `#${channel.name}`,
  }));
  const currentChannelIsAvailable = channels.some(
    (channel) => channel.id === currentChannelId,
  );
  return currentChannelIsAvailable || currentChannelId.length === 0
    ? options
    : [
        {
          value: currentChannelId,
          label: `Current channel (${currentChannelId})`,
          disabled: true,
        },
        ...options,
      ];
}

export function channelSelectDisabled(
  availability: ChannelAvailability,
  channelCount: number,
): boolean {
  return availability.status === "loading" || channelCount === 0;
}

type ChannelSelectRenderProps = {
  id: string;
  label: string;
  placeholder: "Pick a channel";
  disabled: boolean;
  options: ReturnType<typeof channelSelectOptions>;
  required: true;
};

export function ChannelSelectControl(props: {
  id: string;
  label: string;
  value: string;
  channels: readonly DiscordChannel[];
  availability?: ChannelAvailability | undefined;
  onRetry?: (() => void) | undefined;
  renderSelect: (selectProps: ChannelSelectRenderProps) => ReactNode;
}) {
  const availability = props.availability ?? { status: "ready" as const };
  return (
    <>
      {props.renderSelect({
        id: props.id,
        label: props.label,
        placeholder: "Pick a channel",
        disabled: channelSelectDisabled(availability, props.channels.length),
        options: channelSelectOptions(props.value, props.channels),
        required: true,
      })}
      {props.availability !== undefined && (
        <ChannelAvailabilityMessage
          availability={props.availability}
          onRetry={props.onRetry}
        />
      )}
    </>
  );
}

export function ChannelAvailabilityMessage(props: {
  availability: ChannelAvailability;
  onRetry?: (() => void) | undefined;
}) {
  const retryButton =
    props.onRetry === undefined ? null : (
      <RetryButton onRetry={props.onRetry} />
    );
  switch (props.availability.status) {
    case "ready":
      return null;
    case "loading":
      return (
        <p role="status" className="text-sm text-scout-subtle">
          Loading available Discord channels…
        </p>
      );
    case "error":
      return (
        <div role="alert" className="space-y-2 text-sm text-scout-danger">
          <p>
            Couldn&apos;t load Discord channels
            {props.availability.message === undefined
              ? "."
              : `: ${props.availability.message}`}
          </p>
          {retryButton}
        </div>
      );
    case "empty":
      return (
        <div role="status" className="space-y-2 text-sm text-scout-subtle">
          <p>
            Scout can&apos;t post to any channels in this server. Check its
            channel permissions, then retry.
          </p>
          {retryButton}
        </div>
      );
  }
}

function RetryButton(props: { onRetry?: (() => void) | undefined }) {
  if (props.onRetry === undefined) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
      Retry
    </Button>
  );
}
