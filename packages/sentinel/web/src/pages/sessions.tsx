import { useState } from "react";
import type { Page } from "@/app";
import { trpc } from "@/lib/trpc";
import { SessionTable } from "@/components/session-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionsProps = {
  onNavigate: (page: Page) => void;
};

export function Sessions({ onNavigate }: SessionsProps) {
  const [agentFilter, setAgentFilter] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();

  const { data, isLoading } = trpc.session.list.useQuery({
    agent: agentFilter === "" ? undefined : agentFilter,
    limit: 50,
    cursor: cursor,
  });

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Sessions
      </h2>

      <div className="mb-6 max-w-xs">
        <Input
          placeholder="Filter by agent..."
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
            setCursor(undefined);
          }}
        />
      </div>

      {isLoading && (
        <p className="py-8 text-center text-sm text-zinc-500">Loading...</p>
      )}

      {data != null && (
        <SessionTable sessions={data.sessions} onNavigate={onNavigate} />
      )}

      {data?.nextCursor != null && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => {
              setCursor(data.nextCursor ?? undefined);
            }}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
