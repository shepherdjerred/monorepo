import { Link } from "react-router";
import { PageTitle } from "#client/components.tsx";

/** Where each recovery job lives; the reviews themselves are unchanged. */
export function RecoveryHubPage() {
  return (
    <>
      <PageTitle title="Recovery">
        <p>
          What to review after a restore from backup or an interrupted upgrade.
        </p>
      </PageTitle>
      <section className="panel">
        <h2>Household reviews</h2>
        <p>
          Titles that stay protected until everyone has said what they still
          want. Members answer here too.
        </p>
        <Link className="text-link" to="/recovery">
          Open recovery reviews
        </Link>
      </section>
      <section className="panel">
        <h2>Library files</h2>
        <p>
          Prove again which files Media published, after a database restore.
        </p>
        <Link className="text-link" to="/manage/recovery/native">
          Reprove restored library files
        </Link>
      </section>
      <section className="panel">
        <h2>Upgrades</h2>
        <p>Files an upgrade archived, and upgrades that stopped part-way.</p>
        <div className="action-row">
          <Link className="text-link" to="/manage/recovery/native/archives">
            Review upgrade archives
          </Link>
          <Link
            className="text-link"
            to="/manage/recovery/native/compensations"
          >
            Review interrupted upgrades
          </Link>
        </div>
      </section>
    </>
  );
}
