import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Landing route for the bot-install redirect (/app/installed).
 *
 * After an admin adds Scout to a server, Discord redirects here and
 * appends `guild_id`. We deep-link straight into that guild's
 * subscriptions page. If `guild_id` is absent (Discord doesn't always
 * include it), we fall back to the guild picker — the bot is now a
 * member of the guild, so it shows up there regardless.
 */
export function Installed() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const guildId = params.get("guild_id");

  useEffect(() => {
    if (guildId !== null && guildId.length > 0) {
      void navigate(`/g/${guildId}/subscriptions`, { replace: true });
    } else {
      void navigate("/", { replace: true });
    }
  }, [guildId, navigate]);

  return (
    <div className="grid min-h-screen place-items-center p-8">
      <p className="text-sm text-muted-foreground">Finishing setup…</p>
    </div>
  );
}
