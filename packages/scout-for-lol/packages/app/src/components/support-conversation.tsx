import { Button } from "@scout-for-lol/design-system/components/button";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
type Message = RouterOutputs["feedback"]["conversation"]["messages"][number];
const DELIVERY_TEXT = {
  QUEUED: "Saved on web; Discord notification queued",
  SENDING: "Saved on web; Discord delivery unconfirmed",
  SENT: "Saved on web and delivered to Discord",
  FAILED:
    "Saved on web; Discord delivery unconfirmed — do not resend automatically",
  DM_DISABLED: "Saved on web; Discord DMs blocked",
};
export const SUPPORT_STATUS_TEXT = {
  OPEN: "Open",
  WAITING_ON_USER: "Waiting on user",
  RESOLVED: "Resolved",
};

export function SupportConversation(props: {
  messages: Message[];
  operator?: boolean;
  onRetryScreenshot?: (id: string) => void;
}) {
  return (
    <div className="space-y-4" aria-label="Conversation history">
      {props.messages.map((message) => (
        <article
          key={message.id}
          className={`space-y-3 rounded-lg border border-border p-4 ${message.direction === "OUTBOUND" ? "bg-scout-raised" : "bg-scout-surface"}`}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold">
              {message.direction === "OUTBOUND"
                ? "Scout team"
                : props.operator === true
                  ? "User"
                  : "You"}
            </span>
            <time
              dateTime={message.createdAt}
              className="text-xs text-scout-subtle"
            >
              {new Date(message.createdAt).toLocaleString()}
            </time>
          </header>
          {message.body !== "" && (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          )}
          {message.screenshots.map((file) => (
            <div key={file.id} className="space-y-2">
              {file.status === "STORED" ? (
                <a
                  href={`/api/support/screenshots/${file.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm underline"
                >
                  View screenshot: {file.name}
                </a>
              ) : (
                <p className="text-sm">
                  {file.name} —{" "}
                  {file.status === "PENDING"
                    ? "Archiving screenshot…"
                    : "Screenshot could not be saved. Retry or resend it using the form or bot DM."}
                </p>
              )}
              {file.status === "FAILED" &&
                props.onRetryScreenshot !== undefined && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      props.onRetryScreenshot?.(file.id);
                    }}
                  >
                    Retry archival
                  </Button>
                )}
            </div>
          ))}
          {props.operator === true && (
            <p className="text-xs text-scout-subtle">
              {message.source === "WEB"
                ? "Web"
                : message.source === "DISCORD_DM"
                  ? "Bot DM"
                  : "Discord form"}
              {message.context.page === undefined
                ? ""
                : ` · ${message.context.page}`}
              {message.context.matchId === undefined
                ? ""
                : ` · Match ${message.context.matchId}`}
              {message.context.serverId === undefined
                ? ""
                : ` · Server ${message.context.serverId}`}
              {message.context.revision === undefined
                ? ""
                : ` · Revision ${message.context.revision}`}
            </p>
          )}
          {props.operator === true &&
            message.replies.map((reply) => (
              <p key={reply.id} className="text-xs text-scout-subtle">
                {DELIVERY_TEXT[reply.status]}
              </p>
            ))}
        </article>
      ))}
    </div>
  );
}
