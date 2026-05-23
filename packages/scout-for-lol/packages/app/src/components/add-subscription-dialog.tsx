import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

type Channel = { id: string; name: string };

type Props = {
  guildId: string;
  channels: Channel[];
  onClose: () => void;
  onAdded: () => void;
};

// Mirror of RegionSchema in @scout-for-lol/data; duplicated here so the
// dialog doesn't have to import the brand-checking schema. Keep in sync.
const REGIONS = [
  { value: "AMERICA_NORTH", label: "NA" },
  { value: "EU_WEST", label: "EUW" },
  { value: "EU_EAST", label: "EUNE" },
  { value: "KOREA", label: "KR" },
  { value: "JAPAN", label: "JP" },
  { value: "BRAZIL", label: "BR" },
  { value: "LAT_NORTH", label: "LAN" },
  { value: "LAT_SOUTH", label: "LAS" },
  { value: "OCEANIA", label: "OCE" },
  { value: "TURKEY", label: "TR" },
  { value: "RUSSIA", label: "RU" },
  { value: "VIETNAM", label: "VN" },
  { value: "TAIWAN", label: "TW" },
  { value: "SINGAPORE", label: "SG" },
  { value: "PBE", label: "PBE" },
] as const;
type RegionValue = (typeof REGIONS)[number]["value"];

export function AddSubscriptionDialog(props: Props) {
  const trpc = useTRPC();
  const [channelId, setChannelId] = useState(props.channels[0]?.id ?? "");
  const [region, setRegion] = useState<RegionValue>("AMERICA_NORTH");
  const [riotIdInput, setRiotIdInput] = useState("");
  const [alias, setAlias] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.subscription.add.mutationOptions({
      onSuccess: (result) => {
        switch (result.kind) {
          case "created":
          case "subscription-already-exists":
            props.onAdded();
            return;
          case "account-already-subscribed":
            setError(
              `That account is already subscribed under "${result.existingPlayerAlias}".`,
            );
            return;
          case "subscription-limit-reached":
            setError(
              `Subscription limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "account-limit-reached":
            setError(
              `Account limit reached (${result.current.toString()}/${result.max.toString()}).`,
            );
            return;
          case "riot-id-not-found":
            setError(`Riot ID not found: ${result.message}`);
            return;
          case "internal-error":
            setError(result.message);
            return;
        }
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[\p{L}0-9 ]{3,16}#[\p{L}0-9]{3,5}$/u.test(riotIdInput)) {
      setError("Riot ID must be in the form game_name#tag");
      return;
    }
    mutation.mutate({
      guildId: props.guildId,
      channelId,
      region,
      // RiotIdSchema accepts the raw string and transforms server-side.
      riotId: riotIdInput,
      alias: alias.trim(),
      ...(discordUserId.length > 0 && { discordUserId }),
    });
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          props.onClose();
        }
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "white",
          padding: "1.5rem",
          borderRadius: 8,
          width: "min(420px, 100%)",
          display: "grid",
          gap: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0 }}>Add subscription</h3>

        <label>
          Channel
          <select
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
            }}
            required
            style={{ width: "100%", padding: "0.4rem" }}
          >
            {props.channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Region
          <select
            value={region}
            onChange={(e) => {
              const next = REGIONS.find((r) => r.value === e.target.value);
              if (next !== undefined) {
                setRegion(next.value);
              }
            }}
            required
            style={{ width: "100%", padding: "0.4rem" }}
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Riot ID (e.g. <code>name#TAG</code>)
          <input
            value={riotIdInput}
            onChange={(e) => {
              setRiotIdInput(e.target.value);
            }}
            required
            style={{ width: "100%", padding: "0.4rem" }}
          />
        </label>

        <label>
          Alias (how it shows up in Scout)
          <input
            value={alias}
            onChange={(e) => {
              setAlias(e.target.value);
            }}
            required
            style={{ width: "100%", padding: "0.4rem" }}
          />
        </label>

        <label>
          Discord user ID (optional)
          <input
            value={discordUserId}
            onChange={(e) => {
              setDiscordUserId(e.target.value);
            }}
            placeholder="e.g. 123456789012345678"
            style={{ width: "100%", padding: "0.4rem" }}
          />
        </label>

        {error !== null && (
          <p style={{ color: "crimson", margin: 0 }}>{error}</p>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}
        >
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
