import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

export function GuildAudit() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const safeGuildId = guildId ?? "";
  const { data, isLoading, error } = useQuery(
    trpc.subscription.listAuditLog.queryOptions(
      { guildId: safeGuildId, limit: 100 },
      { enabled: guildId !== undefined },
    ),
  );

  if (guildId === undefined) return <p>Missing guild id</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Audit log</h2>
        <Link to={`/g/${guildId}`}>← Subscriptions</Link>
      </div>

      {isLoading && <p>Loading…</p>}
      {error && (
        <p style={{ color: "crimson" }}>Failed to load: {error.message}</p>
      )}

      {data && data.length === 0 && <p>No audit entries yet.</p>}

      {data && data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "0.5rem" }}>When</th>
              <th style={{ padding: "0.5rem" }}>Actor</th>
              <th style={{ padding: "0.5rem" }}>Action</th>
              <th style={{ padding: "0.5rem" }}>Channel</th>
              <th style={{ padding: "0.5rem" }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "0.5rem" }}>
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem" }}>{row.actorDiscordId}</td>
                <td style={{ padding: "0.5rem" }}>{row.action}</td>
                <td style={{ padding: "0.5rem" }}>
                  {row.targetChannelId ?? "—"}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  <pre style={{ margin: 0, fontSize: "0.8em" }}>
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
