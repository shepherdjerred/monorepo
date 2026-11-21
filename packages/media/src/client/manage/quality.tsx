import { PageTitle } from "#client/components.tsx";
import { GuideSection } from "./quality/guide.tsx";
import { ProfileSections } from "./quality/profiles.tsx";

export function QualityPage() {
  return (
    <>
      <PageTitle title="Quality">
        <p>
          The living-room guide and the profiles that decide which releases are
          good enough.
        </p>
      </PageTitle>
      <GuideSection />
      <ProfileSections />
    </>
  );
}
