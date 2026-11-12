import { useRef, useState, type ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { z } from "zod";
import {
  Archive,
  Copy,
  ExternalLink,
  GitBranch,
  GitFork,
  Link2,
  ListPlus,
  SquareCheck,
  Trash2,
  Unlink,
  UserRoundCheck,
} from "lucide-react";
import { duePanel } from "#client/due/due-picker.tsx";
import {
  removeParent,
  requestParent,
  requestSubIssue,
} from "#client/hierarchy/hierarchy-actions.ts";
import type { BootstrapData, Issue } from "#client/data/api.ts";
import {
  assignToMe,
  confirmDelete,
  copyBranchNames,
  copyIds,
  copyLinks,
  openInNewTab,
  toggleArchived,
} from "./issue-actions.ts";
import { selectionStore, toggleSelected, useSelection } from "./selection.ts";
import { Item, PropertyMenus, ReleaseContext } from "./menu-items.tsx";
import { feedback } from "#client/feedback/index.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";

/**
 * Lifting the finger after a long press clicks the menu that opened under
 * it, at the point it was pressed; that click is not a choice.
 */
const PointerSchema = z.object({ clientX: z.number(), clientY: z.number() });

function isRelease(
  event: Event,
  pressedAt: { x: number; y: number } | undefined,
) {
  const point = PointerSchema.safeParse(event);
  return (
    pressedAt !== undefined &&
    point.success &&
    Math.hypot(
      point.data.clientX - pressedAt.x,
      point.data.clientY - pressedAt.y,
    ) < 12
  );
}

const rowOf = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLElement>("[data-row-issue]")?.dataset["rowIssue"]
    : undefined;

/** Where the issues sit in a hierarchy: their parent, a new sub-issue. */
function HierarchyItems({
  issues,
  targets,
}: {
  issues: readonly Issue[];
  targets: readonly string[];
}) {
  const [only, ...rest] = issues;
  return (
    <>
      <Item
        icon={<GitFork size={15} />}
        label="Set parent…"
        onClick={() => {
          requestParent(targets);
        }}
      />
      {only !== undefined && rest.length === 0 && (
        <Item
          icon={<ListPlus size={15} />}
          label="Add sub-issue"
          shortcut="O"
          onClick={() => {
            requestSubIssue(only.identifier);
          }}
        />
      )}
      {issues.some((issue) => issue.parent !== null) && (
        <Item
          icon={<Unlink size={15} />}
          label="Remove parent"
          onClick={() => {
            removeParent(targets);
          }}
        />
      )}
    </>
  );
}

/** The actions for the issues the menu opened on. */
function MenuItems({
  issues,
  targets,
  bootstrap,
  scope,
}: {
  issues: readonly Issue[];
  targets: readonly string[];
  bootstrap: BootstrapData;
  scope: string;
}) {
  const selection = useSelection(scope);
  const [only] = issues;
  const disabled = !bootstrap.writesEnabled;
  const anchor = () =>
    document.querySelector<HTMLElement>(
      `a[data-issue-row="${CSS.escape(targets[0] ?? "")}"]`,
    );
  const selected = only !== undefined && selection.ids.has(only.identifier);
  return (
    <>
      <div className="menu-heading" aria-hidden="true">
        {issues.length === 1
          ? `${only?.identifier ?? ""} · ${only?.title ?? ""}`
          : `${String(issues.length)} issues`}
      </div>
      {!disabled && (
        <PropertyMenus issues={issues} bootstrap={bootstrap} anchor={anchor} />
      )}
      {!disabled && (
        <>
          <Item
            icon={<UserRoundCheck size={15} />}
            label="Assign to me"
            shortcut="i"
            onClick={() => {
              assignToMe(targets);
            }}
          />
          <HierarchyItems issues={issues} targets={targets} />
        </>
      )}
      {only !== undefined && issues.length === 1 && (
        <Item
          icon={<SquareCheck size={15} />}
          label={selected ? "Deselect" : "Select"}
          shortcut="x"
          onClick={() => {
            feedback("select");
            selectionStore.update(scope, (value) =>
              toggleSelected(value, only.identifier),
            );
          }}
        />
      )}
      <ContextMenu.Separator className="menu-separator" />
      <Item
        icon={<Copy size={15} />}
        label={issues.length === 1 ? "Copy ID" : "Copy IDs"}
        shortcut="copyId"
        onClick={() => {
          copyIds(targets);
        }}
      />
      <Item
        icon={<Link2 size={15} />}
        label={issues.length === 1 ? "Copy link" : "Copy links"}
        shortcut="copyLink"
        onClick={() => {
          copyLinks(targets);
        }}
      />
      <Item
        icon={<GitBranch size={15} />}
        label={issues.length === 1 ? "Copy branch name" : "Copy branch names"}
        onClick={() => {
          copyBranchNames(targets);
        }}
      />
      {only !== undefined && issues.length === 1 && (
        <Item
          icon={<ExternalLink size={15} />}
          label="Open in new tab"
          onClick={() => {
            openInNewTab(only.identifier);
          }}
        />
      )}
      {!disabled && (
        <>
          <ContextMenu.Separator className="menu-separator" />
          <Item
            icon={<Archive size={15} />}
            label={
              issues.length > 0 &&
              issues.every((issue) => issue.archivedAt !== null)
                ? "Unarchive"
                : "Archive"
            }
            onClick={() => {
              toggleArchived(targets);
            }}
          />
          <Item
            icon={<Trash2 size={15} />}
            label="Delete…"
            danger
            onClick={() => {
              confirmDelete(targets);
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * Right click, or a long press on touch, on a row or card opens the issue's
 * actions: on the whole selection when that row is part of it.
 */
export function IssueContextMenu({
  bootstrap,
  items,
  scope,
  className,
  children,
}: {
  bootstrap: BootstrapData;
  items: readonly Issue[];
  scope: string;
  className: string;
  children: ReactNode;
}) {
  const [targets, setTargets] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const pressed = useRef<string>(undefined);
  const touchedAt = useRef<{ x: number; y: number }>(undefined);
  const pressedAt = useRef<{ x: number; y: number }>(undefined);
  const selection = useSelection(scope);
  const issues = items.filter(({ identifier }) => targets.includes(identifier));
  const [only] = issues;
  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next) {
          setOpen(false);
          return;
        }
        // The menu offers "Pick a date…"; its picker loads meanwhile.
        duePanel.prefetch();
        const byTouch = details.event.type === "touchstart";
        touchedAt.current = byTouch ? pressedAt.current : undefined;
        const row = pressed.current;
        if (row === undefined) {
          return;
        }
        if (byTouch) {
          feedback("longPress");
        }
        setTargets(
          selection.ids.has(row)
            ? items
                .map(({ identifier }) => identifier)
                .filter((identifier) => selection.ids.has(identifier))
            : [row],
        );
        setOpen(true);
      }}
    >
      <ContextMenu.Trigger
        className={className}
        onPointerDownCapture={(event) => {
          pressed.current = rowOf(event.target);
          pressedAt.current = { x: event.clientX, y: event.clientY };
        }}
        onContextMenuCapture={(event) => {
          pressed.current = rowOf(event.target);
          // Away from an issue the browser keeps its own menu.
          if (pressed.current === undefined) {
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ReleaseContext
        value={(event) => {
          const release = isRelease(event, touchedAt.current);
          // Only the one click that ends the press.
          touchedAt.current = undefined;
          return release;
        }}
      >
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="picker-positioner">
            <ContextMenu.Popup
              render={leavingPopup}
              className="menu-popup"
              aria-label={
                issues.length === 1
                  ? `Actions for ${only?.identifier ?? ""}`
                  : `Actions for ${String(issues.length)} issues`
              }
            >
              <MenuItems
                issues={issues}
                targets={targets}
                bootstrap={bootstrap}
                scope={scope}
              />
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ReleaseContext>
    </ContextMenu.Root>
  );
}
