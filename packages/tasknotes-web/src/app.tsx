import type { TaskUpdateArgs } from "@shepherdjerred/facet-protocol";
import { useEffect, useRef, useState } from "react";
import { effectiveCivilDay, today } from "./civil-day.ts";
import { ConnectScreen } from "./connect-screen.tsx";
import type { TaskDraft } from "./inspector.tsx";
import { WorkspaceScreen } from "./workspace-screen.tsx";
import {
  clearSession,
  loadSession,
  saveSession,
  syncEndpoint,
  type KeyValueStore,
  type SavedSession,
} from "./session.ts";
import {
  applyLocal,
  commandFailure,
  emptyWorkspace,
  mergeSync,
  postSync,
  SyncHttpError,
  taskAddCommand,
  taskCompleteCommand,
  taskDeleteCommand,
  taskUncompleteCommand,
  taskUpdateCommand,
  type WorkspaceData,
} from "./sync.ts";
import { workspaceView, type Destination } from "./workspace.ts";

function browserStores(): { local: KeyValueStore; session: KeyValueStore } {
  return { local: globalThis.localStorage, session: globalThis.sessionStorage };
}

async function runQueued(
  previous: Promise<void>,
  job: () => Promise<void>,
): Promise<void> {
  try {
    await previous;
  } catch (error_: unknown) {
    if (!(error_ instanceof Error)) throw error_;
  }
  await job();
}

async function loadWorkspace(session: SavedSession): Promise<WorkspaceData> {
  const response = await postSync({
    endpoint: syncEndpoint(session.origin),
    token: session.token,
    commands: [],
  });
  const failure = commandFailure(response);
  if (failure !== undefined) throw new Error(failure);
  return mergeSync(emptyWorkspace(), response);
}

export function App() {
  const timeZone =
    new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const currentDay = today(timeZone);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [session, setSession] = useState<SavedSession | null>(null);
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace());
  const [destination, setDestination] = useState<Destination>({
    kind: "section",
    section: "inbox",
  });
  const [search, setSearch] = useState("");
  const [upcomingOffset, setUpcomingOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const committed = useRef(data);
  const chain = useRef(Promise.resolve());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const existing = loadSession(browserStores());
    if (existing === null) {
      setBooting(false);
      return;
    }
    void openSession(existing);
  }, []);

  async function openSession(next: SavedSession) {
    setBusy(true);
    setError(null);
    try {
      const workspace = await loadWorkspace(next);
      saveSession(browserStores(), next);
      committed.current = workspace;
      setData(workspace);
      setSession(next);
      setStatus("Synced");
    } catch (error_) {
      if (error_ instanceof SyncHttpError && error_.status === 401) {
        clearSession(browserStores());
      }
      setError(
        error_ instanceof Error
          ? error_.message
          : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
      setBooting(false);
    }
  }

  function enqueue(command: Parameters<typeof applyLocal>[1], note?: string) {
    const active = sessionRef.current;
    if (active === null) return;
    if (note !== undefined) setStatus(note);
    chain.current = runQueued(chain.current, async () => {
      const previous = committed.current;
      setData(applyLocal(previous, command, new Date().toISOString()));
      try {
        const response = await postSync({
          endpoint: syncEndpoint(active.origin),
          token: active.token,
          syncToken: previous.syncToken,
          commands: [command],
        });
        const failure = commandFailure(response);
        if (failure !== undefined) throw new Error(failure);
        const next = mergeSync(previous, response);
        committed.current = next;
        setData(next);
        setError(null);
        setStatus("Synced");
      } catch (error_) {
        committed.current = previous;
        setData(previous);
        setError(error_ instanceof Error ? error_.message : "Sync failed.");
      }
    });
  }

  if (booting) {
    return (
      <main className="gate">
        <p role="status">Loading TaskNotes…</p>
      </main>
    );
  }

  if (session === null) {
    return (
      <ConnectScreen
        initialOrigin=""
        initialToken=""
        initialRemember={false}
        error={error}
        busy={busy}
        onSubmit={(next) => {
          void openSession(next);
        }}
      />
    );
  }

  const view = workspaceView({
    data,
    destination,
    search,
    today: currentDay,
    timeZone,
    upcomingOffset,
  });
  const selected =
    data.tasks.find((task) => task.id === selectedId && !task.is_deleted) ??
    null;

  return (
    <WorkspaceScreen
      data={data}
      view={view}
      destination={destination}
      search={search}
      timeZone={timeZone}
      today={currentDay}
      upcomingOffset={upcomingOffset}
      selected={selected}
      status={status}
      error={error}
      onSearch={setSearch}
      onDestination={(next) => {
        setDestination(next);
        setSelectedId(null);
        if (next.kind !== "section" || next.section !== "upcoming") {
          setUpcomingOffset(0);
        }
      }}
      onUpcomingOffset={setUpcomingOffset}
      onToggle={(task) => {
        enqueue(
          task.completed
            ? taskUncompleteCommand(
                { id: task.id },
                { uuid: crypto.randomUUID() },
              )
            : taskCompleteCommand(
                { id: task.id, completed_at: new Date().toISOString() },
                { uuid: crypto.randomUUID() },
              ),
        );
      }}
      onOpen={(task) => {
        setSelectedId(task.id);
      }}
      onCloseInspector={() => {
        setSelectedId(null);
      }}
      onAdd={(title) => {
        const projectId = destination.kind === "project" ? destination.id : "";
        enqueue(
          taskAddCommand(
            { title, project_id: projectId },
            { uuid: crypto.randomUUID(), tempId: crypto.randomUUID() },
          ),
          `Added ${title}`,
        );
      }}
      onSave={(draft: TaskDraft) => {
        if (selected === null) return;
        const args: TaskUpdateArgs = {
          id: selected.id,
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          project_id: draft.projectId,
          label_ids: draft.labelIds,
        };
        const currentDue = effectiveCivilDay(selected, timeZone) ?? "";
        if (draft.dueDate !== currentDue) {
          args.due_date = draft.dueDate;
          args.due_datetime = "";
          args.due_string = "";
        }
        enqueue(taskUpdateCommand(args, { uuid: crypto.randomUUID() }));
      }}
      onDelete={(task) => {
        setSelectedId(null);
        enqueue(
          taskDeleteCommand({ id: task.id }, { uuid: crypto.randomUUID() }),
        );
      }}
      onRefresh={() => {
        const active = sessionRef.current;
        if (active === null) return;
        chain.current = runQueued(chain.current, async () => {
          const previous = committed.current;
          try {
            const response = await postSync({
              endpoint: syncEndpoint(active.origin),
              token: active.token,
              syncToken: previous.syncToken,
              commands: [],
            });
            const next = mergeSync(previous, response);
            committed.current = next;
            setData(next);
            setStatus("Synced");
            setError(null);
          } catch (error_) {
            setError(error_ instanceof Error ? error_.message : "Sync failed.");
          }
        });
      }}
      onSignOut={() => {
        clearSession(browserStores());
        committed.current = emptyWorkspace();
        setSession(null);
        setData(emptyWorkspace());
        setSelectedId(null);
        setSearch("");
        setStatus(null);
        setError(null);
      }}
    />
  );
}
