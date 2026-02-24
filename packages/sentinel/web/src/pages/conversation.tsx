import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { ConversationViewer } from "@/components/conversation-viewer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MessageSquare, ChevronDown, ChevronRight } from "lucide-react";

type SelectedConversation = {
  filename: string;
  agent: string;
};

type ConversationProps = {
  initialSessionId?: string | undefined;
};

export function Conversation({ initialSessionId }: ConversationProps) {
  const [selected, setSelected] = useState<SelectedConversation | null>(null);
  const [search, setSearch] = useState("");
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const { data: groups, isLoading: groupsLoading } =
    trpc.conversation.list.useQuery();

  // Load conversation by sessionId if provided
  const { data: sessionData } = trpc.conversation.bySession.useQuery(
    { sessionId: initialSessionId ?? "" },
    { enabled: initialSessionId != null },
  );

  useEffect(() => {
    if (sessionData?.file != null && selected == null) {
      setSelected({
        filename: sessionData.file.filename,
        agent: sessionData.file.agent,
      });
      setExpandedAgents((prev) => new Set([...prev, sessionData.file.agent]));
    }
  }, [sessionData, selected]);

  // Auto-expand all agents on first load
  useEffect(() => {
    if (groups != null && expandedAgents.size === 0) {
      setExpandedAgents(new Set(groups.map((g) => g.agent)));
    }
  }, [groups, expandedAgents.size]);

  const { data: entries, isLoading: entriesLoading } =
    trpc.conversation.read.useQuery(
      { filename: selected?.filename ?? "", agent: selected?.agent ?? "unknown" },
      { enabled: selected != null },
    );

  const toggleAgent = (agent: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) {
        next.delete(agent);
      } else {
        next.add(agent);
      }
      return next;
    });
  };

  const lowerSearch = search.toLowerCase();
  const filteredGroups = groups?.map((group) => ({
    ...group,
    files: group.files.filter((f) =>
      f.filename.toLowerCase().includes(lowerSearch)
      || f.agent.toLowerCase().includes(lowerSearch)
      || f.sessionId.toLowerCase().includes(lowerSearch),
    ),
  })).filter((g) => g.files.length > 0);

  const selectedKey = selected == null ? null : `${selected.agent}/${selected.filename}`;

  return (
    <div className="flex h-full gap-6">
      {/* Left panel: agent-grouped file list */}
      <div className="w-80 shrink-0 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Conversations
          </h3>
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="h-8 text-xs"
          />
        </div>

        {groupsLoading && (
          <p className="p-4 text-sm text-zinc-500">Loading...</p>
        )}
        {filteredGroups?.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">No conversations found.</p>
        )}
        {filteredGroups != null && filteredGroups.length > 0 && (
          <div>
            {filteredGroups.map((group) => {
              const isExpanded = expandedAgents.has(group.agent);
              return (
                <div key={group.agent}>
                  <button
                    onClick={() => { toggleAgent(group.agent); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    {isExpanded
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                    {group.agent}
                    <span className="ml-auto text-zinc-400">{group.files.length}</span>
                  </button>
                  {isExpanded && (
                    <ul>
                      {group.files.map((file) => {
                        const key = `${group.agent}/${file.filename}`;
                        const isSelected = selectedKey === key;
                        const ts = new Date(file.timestamp);
                        const timeStr = ts.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        return (
                          <li key={key}>
                            <button
                              onClick={() => {
                                setSelected({
                                  filename: file.filename,
                                  agent: group.agent,
                                });
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 px-6 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800",
                                isSelected &&
                                  "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                              )}
                            >
                              <MessageSquare size={12} className="shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-mono">
                                  {file.sessionId.slice(0, 8)}
                                </div>
                                <div className="text-xs text-zinc-400">
                                  {timeStr}
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right panel: conversation viewer */}
      <div className="min-w-0 flex-1">
        {selected == null && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">
              Select a conversation to view.
            </p>
          </div>
        )}
        {selected != null && entriesLoading && (
          <p className="py-8 text-center text-sm text-zinc-500">Loading...</p>
        )}
        {selected != null && entries != null && (
          <ConversationViewer entries={entries} />
        )}
      </div>
    </div>
  );
}
