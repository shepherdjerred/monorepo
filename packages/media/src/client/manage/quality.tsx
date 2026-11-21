import { useQuery } from "@tanstack/react-query";
import { ProfileListSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { ErrorNotice, Loading, PageTitle } from "#client/components.tsx";
import { ProfileEditor } from "#client/profile-controls.tsx";
import { QualityGuideAdministration } from "#client/quality-guide/administration.tsx";
import { useUser } from "#client/shell/user.ts";

export function QualityPage() {
  const user = useUser();
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  return (
    <>
      <PageTitle title="Quality">
        <p>
          The living-room guide and the profiles that decide which releases are
          good enough.
        </p>
      </PageTitle>
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
      <QualityGuideAdministration user={user} />
      <section className="panel">
        <h2>Quality profiles</h2>
        {profiles.isPending && <Loading />}
        {profiles.data?.length === 0 && (
          <p className="muted">No quality profiles have been configured yet.</p>
        )}
        {profiles.data?.map((profile) => (
          <details className="profile-details" key={profile.id}>
            <summary>
              {profile.name}
              <span>Version {profile.version}</span>
            </summary>
            <ProfileEditor user={user} profile={profile} />
          </details>
        ))}
      </section>
      <section className="panel">
        <h2>Create a quality profile</h2>
        <ProfileEditor user={user} profile={null} />
      </section>
    </>
  );
}
