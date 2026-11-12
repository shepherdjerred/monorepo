import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { bootstrapKey, optimistic, type Outcome } from "#client/data/cache.ts";
import { currentActor } from "#client/data/identity.ts";
import { noteActor, workspace } from "#client/data/mutations.ts";
import { notify, notifyError } from "#client/ui/toast.tsx";
import type { SavedView, ViewParams } from "./view-params.ts";

type ViewFields = {
  name: string;
  icon: string;
  params: ViewParams;
  teamKey: string | null;
};

function setViews(change: (views: SavedView[]) => SavedView[]) {
  queryClient.setQueryData<BootstrapData>(bootstrapKey, (data) =>
    data === undefined ? data : { ...data, views: change(data.views) },
  );
}

/** Views live in the workspace; every view change refetches it. */
function settle() {
  void queryClient.invalidateQueries({ queryKey: bootstrapKey });
}

function report<T>(
  outcome: Outcome<T>,
  done: string | undefined,
  failed: string,
) {
  if (outcome.ok) {
    noteActor();
    if (done !== undefined) {
      notify(done);
    }
  } else {
    notifyError(
      `${failed}: ${outcome.error instanceof Error ? outcome.error.message : "something went wrong"}`,
    );
  }
  return outcome;
}

/** Save a view. It shows in the sidebar at once, last in the order. */
export async function createView(fields: ViewFields) {
  const views = workspace().views;
  const now = new Date().toISOString();
  const actor = currentActor();
  const draft: SavedView = {
    id: `optimistic-${crypto.randomUUID()}`,
    ...fields,
    position: Math.max(-1, ...views.map(({ position }) => position)) + 1,
    createdBy: {
      id: `optimistic-${actor.key}`,
      key: actor.key,
      kind: actor.kind,
      name: actor.name,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 0,
      firstMetadata: actor.metadata,
      metadata: actor.metadata,
    },
    createdAt: now,
    updatedAt: now,
  };
  const outcome = await optimistic({
    apply: () => {
      setViews((known) => [...known, draft]);
      return () => {
        setViews((known) => known.filter(({ id }) => id !== draft.id));
      };
    },
    run: async () => {
      const saved = await api.views.create.mutate({
        actor: currentActor(),
        ...fields,
      });
      setViews((known) =>
        known.map((view) => (view.id === draft.id ? saved : view)),
      );
      return saved;
    },
    settle,
  });
  return report(outcome, `View “${fields.name}” saved`, "View not saved");
}

/** Change a view's name, icon, scope or what it shows. */
export async function updateView(id: string, fields: Partial<ViewFields>) {
  const before = workspace().views.find((view) => view.id === id);
  if (before === undefined) {
    throw new Error(`View ${id} is not loaded`);
  }
  const outcome = await optimistic({
    apply: () => {
      setViews((known) =>
        known.map((view) => (view.id === id ? { ...view, ...fields } : view)),
      );
      return () => {
        setViews((known) =>
          known.map((view) => (view.id === id ? before : view)),
        );
      };
    },
    run: () =>
      api.views.update.mutate({ actor: currentActor(), id, ...fields }),
    settle,
  });
  return report(
    outcome,
    `View “${fields.name ?? before.name}” updated`,
    "View not updated",
  );
}

export async function deleteView(view: SavedView) {
  const outcome = await optimistic({
    apply: () => {
      setViews((known) => known.filter(({ id }) => id !== view.id));
      return () => {
        setViews((known) =>
          known.some(({ id }) => id === view.id) ? known : [...known, view],
        );
      };
    },
    run: () => api.views.delete.mutate({ actor: currentActor(), id: view.id }),
    settle,
  });
  return report(outcome, `View “${view.name}” deleted`, "View not deleted");
}

/** Put the views in this order: every view, each once. */
export async function reorderViews(ids: readonly string[]) {
  const before = workspace().views;
  const outcome = await optimistic({
    apply: () => {
      setViews((known) =>
        known.map((view) => ({ ...view, position: ids.indexOf(view.id) })),
      );
      return () => {
        setViews(() => before);
      };
    },
    run: () =>
      api.views.reorder.mutate({ actor: currentActor(), ids: [...ids] }),
    settle,
  });
  return report(outcome, undefined, "Views not reordered");
}
