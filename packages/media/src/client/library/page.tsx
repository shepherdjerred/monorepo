import type { MediaUser } from "#shared/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { LibraryAll } from "./all.tsx";

export function LibraryPage({ user }: { user: MediaUser }) {
  return (
    <>
      <PageTitle title="Library">
        <p>Everything your household has, and what is on its way.</p>
      </PageTitle>
      <LibraryAll user={user} />
    </>
  );
}
