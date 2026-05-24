import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

export function GuildPicker() {
  const trpc = useTRPC();
  const { data, isLoading, error } = useQuery(
    trpc.guild.listManageable.queryOptions(),
  );

  if (isLoading) return <p>Loading guilds…</p>;
  if (error)
    return (
      <p style={{ color: "crimson" }}>Failed to load guilds: {error.message}</p>
    );
  if (data === undefined || data.length === 0) {
    return (
      <div>
        <h2>No manageable guilds</h2>
        <p>
          You need to be a Discord Administrator in a server where Scout is
          installed. Invite Scout, then come back here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2>Pick a guild</h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: "0.5rem",
        }}
      >
        {data.map((g) => (
          <li
            key={g.id}
            style={{
              border: "1px solid #ddd",
              padding: "0.75rem",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            {g.icon === null ? (
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "#eee",
                  borderRadius: 6,
                }}
              />
            ) : (
              <img
                src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`}
                alt=""
                width={32}
                height={32}
                style={{ borderRadius: 6 }}
              />
            )}
            <Link to={`/g/${g.id}`} style={{ flex: 1 }}>
              <strong>{g.name}</strong>
              {g.isOwner && <span style={{ marginLeft: 8 }}>(owner)</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
