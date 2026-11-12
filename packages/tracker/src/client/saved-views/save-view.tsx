import { useState } from "react";
import { useSearchParams } from "react-router";
import { BookmarkPlus, RefreshCw } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { createView, updateView } from "./view-mutations.ts";
import { deferred } from "#client/ui/lazy.ts";
import { notifyError } from "#client/ui/toast.tsx";

/** The save and edit dialog and its icon picker load when first wanted. */
export const viewDialog = deferred(() => import("./view-dialog.tsx"));

/** Open the dialog once its code is here; a failed fetch says so. */
export async function withViewDialog(show: () => void) {
  try {
    await viewDialog.load();
  } catch {
    notifyError("The view dialog could not load. Check the connection.");
    return;
  }
  show();
}
import {
  hasViewParams,
  savedViewParam,
  scopedParams,
  viewMatches,
  viewParamsFrom,
} from "./view-params.ts";

/** The list's view parameters and the saved view it was opened from. */
function useCurrentView(
  bootstrap: BootstrapData,
  scope: { teamKey: string; board: boolean; projectSlug: string | undefined },
) {
  const [params] = useSearchParams();
  const search = new URLSearchParams(params);
  if (scope.projectSlug !== undefined) {
    search.set("project", scope.projectSlug);
  }
  const current = viewParamsFrom(search, {
    board: scope.board,
    teamKey: scope.teamKey,
    me: currentActor().key,
  });
  const source = bootstrap.views.find(
    (view) => view.id === params.get(savedViewParam),
  );
  return { current, source };
}

/**
 * "Save view" once the list differs from the plain one, and "Update view"
 * when a list opened from a view has changed since.
 */
export function SaveView({
  bootstrap,
  teamKey,
  board,
  projectSlug,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  board: boolean;
  projectSlug: string | undefined;
}) {
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState(0);
  const [open, setOpen] = useState(false);
  const ViewDialog = viewDialog.current?.ViewDialog;
  const { current, source } = useCurrentView(bootstrap, {
    teamKey,
    board,
    projectSlug,
  });
  const { view: _view, ...filters } = current;
  const changed = source !== undefined && !viewMatches(source, current);
  if (
    !bootstrap.writesEnabled ||
    (source === undefined && !hasViewParams(filters))
  ) {
    return null;
  }
  if (source !== undefined && !changed) {
    return null;
  }
  return (
    <div className="save-view">
      {changed && (
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            void updateView(source.id, {
              params: scopedParams(current, source.teamKey),
            });
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          <span className="toolbar-label">Update view</span>
        </button>
      )}
      <button
        type="button"
        id="save-view"
        className="toolbar-button"
        onPointerEnter={viewDialog.prefetch}
        onFocus={viewDialog.prefetch}
        onClick={() => {
          void withViewDialog(() => {
            setDialog((count) => count + 1);
            setOpen(true);
          });
        }}
      >
        <BookmarkPlus size={14} aria-hidden="true" />
        <span className="toolbar-label">
          {changed ? "Save as new view" : "Save view"}
        </span>
      </button>
      {ViewDialog !== undefined && (
        <ViewDialog
          key={dialog}
          open={open}
          title="Save view"
          submitLabel="Save view"
          teamKey={teamKey}
          onClose={() => {
            setOpen(false);
          }}
          onSubmit={(draft) => {
            setOpen(false);
            void (async () => {
              const outcome = await createView({
                ...draft,
                params: scopedParams(current, draft.teamKey),
              });
              if (outcome.ok) {
                const next = new URLSearchParams(params);
                next.set(savedViewParam, outcome.value.id);
                setParams(next, { replace: true, preventScrollReset: true });
              }
            })();
          }}
        />
      )}
    </div>
  );
}
