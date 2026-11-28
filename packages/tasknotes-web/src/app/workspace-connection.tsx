import { useState } from "react";
import { ConnectScreen } from "#ui/connect-screen.tsx";
import { reportAction } from "./ui-action.ts";
import { DecisionDialog } from "./workspace-dialog.tsx";
import { workspaceEngine } from "#sync/workspace-engine.ts";

export function WorkspaceConnection(props: {
  snapshot: ReturnType<typeof workspaceEngine.getSnapshot>;
}) {
  const { snapshot } = props;
  const [attach, setAttach] = useState(false);
  const [remove, setRemove] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = snapshot.profile?.kind === "local";
  return (
    <section aria-labelledby="workspace-connection-heading">
      <h2 id="workspace-connection-heading">Workspace and sync</h2>
      <p>
        {local
          ? "Tasks are saved on this device."
          : "Connected to your Facet workspace."}
      </p>
      {snapshot.canWrite ? null : (
        <p>You’re connected with read-only access.</p>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
      {snapshot.pendingCount > 0 ? (
        <p>{snapshot.pendingCount} changes waiting to sync.</p>
      ) : null}
      {local ? (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setAttach(true);
          }}
        >
          Connect workspace
        </button>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void workspaceEngine.sync();
            }}
          >
            Sync now
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              workspaceEngine.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        className="danger"
        onClick={() => {
          setRemove(true);
        }}
      >
        Remove local data
      </button>
      {snapshot.rejected.length > 0 ? (
        <div>
          <h3>Changes that need attention</h3>
          <ul className="sync-errors">
            {snapshot.rejected.map((entry) => (
              <li key={entry.uuid}>
                <p>{entry.error}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void reportAction(
                      () => workspaceEngine.retryRejected(entry.uuid),
                      setError,
                    );
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    void reportAction(
                      () => workspaceEngine.removeRejected(entry.uuid),
                      setError,
                    );
                  }}
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {attach ? (
        <DecisionDialog
          title="Connect your local workspace?"
          detail="Tasks saved on this device will sync to the server you sign in to."
          action="Continue to sign in"
          onDecision={() => {
            setAttach(false);
            setConfirmed(true);
          }}
          onDismiss={() => {
            setAttach(false);
          }}
        />
      ) : null}
      {confirmed ? (
        <ConnectScreen
          embedded
          initialOrigin=""
          initialRemember={false}
          initialToken=""
          error={snapshot.error}
          busy={snapshot.syncStatus === "syncing"}
          onSubmit={(session) => {
            void reportAction(
              () => workspaceEngine.connect(session, { attachLocal: true }),
              setError,
            );
          }}
        />
      ) : null}
      {remove ? (
        <DecisionDialog
          title="Remove data from this browser?"
          detail="This deletes locally saved drafts and changes that haven’t synced. Tasks on the server are still available after sign-in."
          action="Remove local data"
          onDismiss={() => {
            setRemove(false);
          }}
          onDecision={() => {
            setRemove(false);
            void reportAction(
              () => workspaceEngine.removeLocalData(),
              setError,
            );
          }}
        />
      ) : null}
    </section>
  );
}
