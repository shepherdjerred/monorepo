import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PlayerAdminForms } from "#src/components/player-admin-forms.tsx";
import { AccountAdminForms } from "#src/components/account-admin-forms.tsx";

export function AdminTools() {
  const { guildId } = useParams();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (guildId === undefined) {
    return <p className="text-sm text-destructive">Missing guild id</p>;
  }

  function setSuccess(message: string): void {
    setError(null);
    setStatus(message);
    void queryClient.invalidateQueries();
  }

  function setFailure(message: string): void {
    setStatus(null);
    setError(message);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Admin</h2>

      {status !== null && (
        <p className="text-sm text-muted-foreground">{status}</p>
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerAdminForms
          guildId={guildId}
          onSuccess={setSuccess}
          onError={setFailure}
        />
        <AccountAdminForms
          guildId={guildId}
          onSuccess={setSuccess}
          onError={setFailure}
        />
      </div>
    </div>
  );
}
