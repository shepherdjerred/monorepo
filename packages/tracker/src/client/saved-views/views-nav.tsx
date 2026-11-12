import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { Modal } from "#client/ui/ui.tsx";
import { deleteView, reorderViews, updateView } from "./view-mutations.ts";
import { viewDialog, withViewDialog } from "./save-view.tsx";
import { ViewIcon } from "./view-icons.tsx";
import {
  moveView,
  reorderTo,
  savedViewParam,
  scopedParams,
  viewMatches,
  viewParamsFrom,
  viewUrl,
  visibleViews,
  type SavedView,
} from "./view-params.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";
import { flipItems } from "#client/feedback/motion.ts";

const dragType = "application/x-tracker-view";

/** Whether the list shown is this view, or was opened from it. */
function useActiveView(teamKey: string | undefined) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const onList =
    location.pathname === "/issues" || location.pathname === "/board";
  const current = viewParamsFrom(search, {
    board: location.pathname === "/board",
    teamKey,
    me: currentActor().key,
  });
  return (view: SavedView) =>
    onList &&
    (search.get(savedViewParam) === view.id || viewMatches(view, current));
}

function ViewActions({
  view,
  index,
  count,
  disabled,
  open,
  setOpen,
  edit,
  remove,
  move,
}: {
  view: SavedView;
  index: number;
  count: number;
  disabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  edit: () => void;
  remove: () => void;
  move: (delta: number) => void;
}) {
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        className="icon-button view-actions"
        aria-label={`Actions for view ${view.name}`}
        disabled={disabled}
      >
        <Ellipsis size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="picker-positioner" align="start">
          <Menu.Popup className="menu-popup" render={leavingPopup}>
            <Menu.Item className="menu-item" onClick={edit}>
              <span className="option-icon">
                <Pencil size={15} />
              </span>
              <span className="option-label">Rename or change icon…</span>
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              disabled={index === 0}
              onClick={() => {
                move(-1);
              }}
            >
              <span className="option-icon">
                <ArrowUp size={15} />
              </span>
              <span className="option-label">Move up</span>
              <kbd aria-hidden="true">⌥ ↑</kbd>
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              disabled={index === count - 1}
              onClick={() => {
                move(1);
              }}
            >
              <span className="option-icon">
                <ArrowDown size={15} />
              </span>
              <span className="option-label">Move down</span>
              <kbd aria-hidden="true">⌥ ↓</kbd>
            </Menu.Item>
            <Menu.Separator className="menu-separator" />
            <Menu.Item className="menu-item danger" onClick={remove}>
              <span className="option-icon">
                <Trash2 size={15} />
              </span>
              <span className="option-label">Delete view…</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The saved views of the team in view and the global ones. Each opens its
 * list; drag one, press Alt+↑ or Alt+↓ on it, or use its menu to reorder.
 * Its menu, also on right click, renames or deletes it.
 */
export function ViewsNav({
  bootstrap,
  teamKey,
  onNavigate,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  /** The phone's sheet closes once a view is chosen. */
  onNavigate?: () => void;
}) {
  const shown = visibleViews(bootstrap.views, teamKey);
  const active = useActiveView(teamKey);
  const [menu, setMenu] = useState<string>();
  const [editing, setEditing] = useState<SavedView>();
  const ViewDialog = viewDialog.current?.ViewDialog;
  const [deleting, setDeleting] = useState<SavedView>();
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const me = currentActor().key;
  const writable = bootstrap.writesEnabled;
  // Views being saved have no server ID to reorder by yet.
  const settled = shown.every((view) => !view.id.startsWith("optimistic-"));
  const reorder = (ids: string[] | undefined, focus?: string) => {
    if (ids === undefined || !settled) {
      return;
    }
    // The views glide to their new places instead of jumping.
    flipItems(".view-nav", "a[data-view]", "view");
    void reorderViews(ids);
    if (focus !== undefined) {
      // Moving the link in the document takes focus from it.
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`a[data-view="${CSS.escape(focus)}"]`)
          ?.focus();
      });
    }
  };
  if (shown.length === 0) {
    return null;
  }
  return (
    <>
      <p className="nav-heading" id="views-heading">
        Views
      </p>
      <ul className="view-nav" aria-labelledby="views-heading">
        {shown.map((view, index) => (
          <li
            key={view.id}
            className="view-nav-item"
            data-over={
              over === view.id && dragging !== view.id ? "" : undefined
            }
            onDragOver={(event) => {
              if (dragging !== undefined) {
                event.preventDefault();
                setOver(view.id);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData(dragType);
              setDragging(undefined);
              setOver(undefined);
              reorder(reorderTo(bootstrap.views, id, view.id));
            }}
          >
            <Link
              to={viewUrl(view, { teamKey, me })}
              className={active(view) ? "active" : ""}
              aria-current={active(view) ? "page" : undefined}
              data-view={view.id}
              draggable={writable && settled}
              onClick={onNavigate}
              onDragStart={(event) => {
                event.dataTransfer.setData(dragType, view.id);
                event.dataTransfer.effectAllowed = "move";
                setDragging(view.id);
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setOver(undefined);
              }}
              onContextMenu={(event) => {
                if (writable) {
                  event.preventDefault();
                  setMenu(view.id);
                }
              }}
              onKeyDown={(event) => {
                if (
                  writable &&
                  event.altKey &&
                  (event.key === "ArrowUp" || event.key === "ArrowDown")
                ) {
                  event.preventDefault();
                  reorder(
                    moveView(
                      bootstrap.views,
                      shown,
                      view.id,
                      event.key === "ArrowUp" ? -1 : 1,
                    ),
                    view.id,
                  );
                }
              }}
            >
              <ViewIcon name={view.icon} />
              <span>{view.name}</span>
              {view.teamKey === null && (
                <span className="view-scope" title="Shown in every team">
                  <span className="sr-only">, all teams</span>
                </span>
              )}
            </Link>
            <ViewActions
              view={view}
              index={index}
              count={shown.length}
              disabled={!writable}
              open={menu === view.id}
              setOpen={(next) => {
                if (next) {
                  viewDialog.prefetch();
                }
                setMenu(next ? view.id : undefined);
              }}
              edit={() => {
                void withViewDialog(() => {
                  setEditing(view);
                });
              }}
              remove={() => {
                setDeleting(view);
              }}
              move={(delta) => {
                reorder(moveView(bootstrap.views, shown, view.id, delta));
              }}
            />
          </li>
        ))}
      </ul>
      {editing !== undefined && ViewDialog !== undefined && (
        <ViewDialog
          key={editing.id}
          open
          title="Edit view"
          submitLabel="Save"
          teamKey={teamKey}
          view={editing}
          onClose={() => {
            setEditing(undefined);
          }}
          onSubmit={(draft) => {
            setEditing(undefined);
            void updateView(editing.id, {
              ...draft,
              params: scopedParams(editing.params, draft.teamKey),
            });
          }}
        />
      )}
      <Modal
        title={`Delete view “${deleting?.name ?? ""}”?`}
        open={deleting !== undefined}
        onClose={() => {
          setDeleting(undefined);
        }}
      >
        <p>The view is removed for everyone. Its issues are not changed.</p>
        <div className="actions">
          <button
            onClick={() => {
              setDeleting(undefined);
            }}
          >
            Cancel
          </button>
          <button
            className="danger"
            onClick={() => {
              if (deleting !== undefined) {
                void deleteView(deleting);
              }
              setDeleting(undefined);
            }}
          >
            Delete view
          </button>
        </div>
      </Modal>
    </>
  );
}
