import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { PlexProfilesSchema } from "#shared/plex-admin.ts";
import { readApi } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";

export function MovieRequestSubject({
  user,
  subjectUserId,
  change,
  disabled = false,
}: {
  user: MediaUser;
  subjectUserId: string;
  change: (id: string) => void;
  disabled?: boolean;
}) {
  const profiles = useQuery({
    queryKey: ["plex-profiles"],
    queryFn: async () => readApi("/admin/plex/profiles", PlexProfilesSchema),
    enabled: user.role === "owner",
  });
  if (user.role !== "owner") return null;
  return (
    <>
      <label>
        Request for
        <select
          value={subjectUserId}
          disabled={disabled}
          onChange={(event) => {
            change(event.target.value);
          }}
        >
          <option value={user.id}>Myself</option>
          {profiles.data?.mappings
            .filter((profile) => profile.kind === "managed")
            .map((profile) => (
              <option key={profile.userId} value={profile.userId}>
                {profile.displayName} — Home ID {profile.homeUserId}
              </option>
            ))}
        </select>
      </label>
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
    </>
  );
}
