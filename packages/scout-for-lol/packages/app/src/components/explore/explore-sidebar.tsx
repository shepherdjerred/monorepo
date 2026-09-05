import { memo, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { ExploreConversation } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";

/**
 * The conversation list.
 *
 * Rendered twice — as a fixed column on desktop and inside a drawer on mobile
 * — so it takes its state from the page rather than owning any. Memoized so
 * composer keystrokes and streamed tokens don't re-render every row's
 * dropdown; the page passes stable callbacks to keep that effective.
 */
export const ExploreSidebar = memo(function ExploreSidebarView(props: {
  conversations: ExploreConversation[];
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onRename: (conversation: ExploreConversation) => void;
  onDelete: (conversation: ExploreConversation) => void;
  statusForConversation: (
    conversationId: string,
  ) => "running" | "completed" | "failed" | null;
  showNewButton?: boolean;
}) {
  const { showNewButton = true } = props;
  const [search, setSearch] = useState("");

  const groups = useMemo(
    () => groupByRecency(filterByTitle(props.conversations, search)),
    [props.conversations, search],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {showNewButton && (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={props.onNew}
        >
          <Plus className="size-4" />
          New conversation
        </Button>
      )}

      {props.conversations.length > 4 && (
        <div className="relative px-0.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-scout-subtle" />
          <input
            type="search"
            value={search}
            placeholder="Search chats…"
            className="h-8 w-full rounded-md border border-transparent bg-scout-hover/50 px-2.5 pl-7 text-sm text-scout-ink placeholder:text-scout-subtle !outline-none transition-colors hover:bg-scout-hover/80 focus:border-scout-border/70 focus:bg-scout-surface focus:!outline-none focus-visible:!outline-none"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-2.5 pt-1 text-xs font-medium text-scout-subtle">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.conversations.map((conversation) => (
                <li
                  key={conversation.id}
                  className={`group relative flex items-center rounded-md transition-colors ${
                    conversation.id === props.activeId
                      ? "bg-scout-hover font-medium text-scout-ink"
                      : "text-scout-ink/85 hover:bg-scout-hover hover:text-scout-ink"
                  }`}
                >
                  <Link
                    to={`/explore/${conversation.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm text-inherit no-underline outline-none"
                    onClick={(event) => {
                      if (
                        event.defaultPrevented ||
                        event.button !== 0 ||
                        event.metaKey ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.shiftKey
                      ) {
                        return;
                      }
                      event.preventDefault();
                      const targetId = conversation.id;
                      props.onSelect(targetId);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate pr-5">
                      {conversation.title}
                    </span>
                    <ConversationRunStatus
                      status={props.statusForConversation(conversation.id)}
                    />
                  </Link>
                  <div className="absolute right-1 flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex size-6 items-center justify-center rounded text-scout-subtle transition-colors hover:bg-scout-canvas hover:text-scout-ink focus:outline-none"
                          aria-label={`Actions for ${conversation.title}`}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem
                          className="gap-2 text-sm"
                          onSelect={() => {
                            props.onRename(conversation);
                          }}
                        >
                          <Pencil className="size-3.5 text-scout-subtle" />
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-sm text-scout-danger focus:bg-scout-danger/10 focus:text-scout-danger"
                          onSelect={() => {
                            props.onDelete(conversation);
                          }}
                        >
                          <Trash2 className="size-3.5 text-scout-danger" />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-2 text-sm text-scout-subtle">
            {search.trim().length > 0
              ? "No conversations match."
              : "No conversations yet."}
          </p>
        )}
      </div>
    </div>
  );
});

function ConversationRunStatus(props: {
  status: "running" | "completed" | "failed" | null;
}) {
  if (props.status === null) return null;
  if (props.status === "running") {
    return (
      <span
        className="shrink-0 text-scout-subtle"
        role="status"
        aria-label="Answer running"
      >
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${
        props.status === "completed" ? "bg-scout-primary" : "bg-scout-danger"
      }`}
      role="status"
      aria-label={
        props.status === "completed"
          ? "New answer available"
          : "Answer needs attention"
      }
    />
  );
}

function filterByTitle(
  conversations: ExploreConversation[],
  search: string,
): ExploreConversation[] {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) {
    return conversations;
  }
  return conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(needle),
  );
}

type Group = { label: string; conversations: ExploreConversation[] };

/**
 * Bucket by last activity.
 *
 * Plain date arithmetic rather than a library: `date-fns` is not a dependency
 * of this app, and four buckets do not justify adding one. Boundaries are
 * local midnights, so "yesterday" means the calendar day rather than the last
 * 24 hours.
 */
function groupByRecency(conversations: ExploreConversation[]): Group[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday.getTime() - dayMs;
  const sevenDaysAgo = startOfToday.getTime() - 7 * dayMs;

  const buckets: Group[] = [
    { label: "Today", conversations: [] },
    { label: "Yesterday", conversations: [] },
    { label: "Previous 7 days", conversations: [] },
    { label: "Older", conversations: [] },
  ];

  for (const conversation of conversations) {
    const updated = Date.parse(conversation.updatedAt);
    const bucket =
      updated >= startOfToday.getTime()
        ? buckets[0]
        : updated >= startOfYesterday
          ? buckets[1]
          : updated >= sevenDaysAgo
            ? buckets[2]
            : buckets[3];
    bucket?.conversations.push(conversation);
  }

  return buckets.filter((bucket) => bucket.conversations.length > 0);
}
