import { memo, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import type { ExploreConversation } from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#src/components/ui/dropdown-menu.tsx";

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
}) {
  const [search, setSearch] = useState("");

  const groups = useMemo(
    () => groupByRecency(filterByTitle(props.conversations, search)),
    [props.conversations, search],
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={props.onNew}
      >
        <Plus className="size-4" />
        New conversation
      </Button>

      {props.conversations.length > 4 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search"
            className="h-8 pl-7 text-sm"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.conversations.map((conversation) => (
                <li key={conversation.id} className="group flex items-center">
                  <button
                    type="button"
                    className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      conversation.id === props.activeId ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      props.onSelect(conversation.id);
                    }}
                  >
                    {conversation.title}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-7 shrink-0 p-0"
                        aria-label={`Actions for ${conversation.title}`}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          props.onRename(conversation);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          props.onDelete(conversation);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">
            {search.trim().length > 0
              ? "No conversations match."
              : "No conversations yet."}
          </p>
        )}
      </div>
    </div>
  );
});

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
