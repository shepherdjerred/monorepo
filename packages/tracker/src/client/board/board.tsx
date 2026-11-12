import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { GripVertical, MessageSquare, ThumbsUp } from "lucide-react";
import type { BootstrapData, Issue } from "#client/data/api.ts";
import { moveIssue } from "#client/data/mutations.ts";
import type { EnumOption } from "#client/controls/enum-picker.tsx";
import {
  priorityOptions,
  stateOptions,
} from "#client/controls/property-options.tsx";
import {
  RowAssignee,
  RowLabels,
  RowPriority,
  RowStatus,
} from "#client/controls/row-controls.tsx";
import { useSelection } from "#client/controls/selection.ts";
import { pickDue } from "#client/controls/issue-actions.ts";
import { RowDue } from "#client/due/due-chip.tsx";
import { SubIssueBadge } from "#client/hierarchy/progress.tsx";
import { StateIcon } from "#client/ui/icons.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { isPlainClick } from "#client/shell/route.ts";
import { useFreshRows } from "#client/live/remote-activity.ts";
import { BoardKeyboardSensor } from "#client/board/keyboard-sensor.ts";
import {
  readDisplay,
  type RowProperty,
} from "#client/views/display-options.ts";

const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin({
    ...args,
    pointerCoordinates: args.pointerCoordinates ?? {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + 20,
    },
  });
  if (hits.length > 0) {
    const cards = hits.filter(
      ({ id }) =>
        args.droppableContainers.find((container) => container.id === id)?.data
          .current?.["column"] !== true,
    );
    return cards.length > 0 ? cards : hits;
  }
  return closestCorners(args);
};
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.code))
    return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { active, over, droppableContainers, droppableRects } = args.context;
  const currentState: unknown =
    over?.data.current?.["stateId"] ?? active?.data.current?.["stateId"];
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => container.data.current?.["column"] === true);
  const index = columns.findIndex((container) => container.id === currentState);
  const target = columns[index + (event.code === "ArrowLeft" ? -1 : 1)];
  const rect = target === undefined ? undefined : droppableRects.get(target.id);
  return rect === undefined
    ? undefined
    : { x: rect.left + 10, y: rect.top + 50 };
};

type CardOptions = {
  states: readonly EnumOption[];
  hidden: ReadonlySet<RowProperty>;
  disabled: boolean;
};

function Card({ issue, options }: { issue: Issue; options: CardOptions }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { stateId: issue.state.id } });
  const { current, setCurrent, openPeek, selectionScope } = useShell();
  const fresh = useFreshRows().has(issue.identifier);
  const selected = useSelection(selectionScope).ids.has(issue.identifier);
  const focus = () => {
    setCurrent(issue.identifier);
  };
  const { hidden, disabled } = options;
  return (
    <article
      ref={setNodeRef}
      data-row-issue={issue.identifier}
      data-selected={selected}
      className={`board-card ${isDragging ? "dragging" : ""}`}
      data-fresh={fresh ? "" : undefined}
      style={{
        transform:
          transform === null
            ? undefined
            : `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)`,
        transition,
      }}
    >
      <div className="card-top">
        <RowStatus
          issue={issue}
          options={options.states}
          disabled={disabled}
          onFocus={focus}
        />
        <span className="identifier">{issue.identifier}</span>
        {issue.parent !== null && (
          <span className="row-parent" title={issue.parent.title}>
            <span className="sr-only">sub-issue of </span>
            {issue.parent.identifier}
          </span>
        )}
        <span className="spacer" />
        <button
          className="drag-handle"
          aria-label={`Move ${issue.identifier}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
      </div>
      <Link
        className="card-title"
        to={`/issues/${issue.identifier}`}
        data-issue-row={issue.identifier}
        aria-current={current === issue.identifier ? "true" : undefined}
        onFocus={() => {
          setCurrent(issue.identifier);
        }}
        onClick={(event) => {
          if (isPlainClick(event)) {
            event.preventDefault();
            openPeek(issue.identifier);
          }
        }}
      >
        {issue.title}
      </Link>
      {!hidden.has("labels") && (
        <div className="card-labels">
          <RowLabels
            issue={issue}
            disabled={disabled}
            onFocus={focus}
            limit={6}
          />
        </div>
      )}
      <div className="card-bottom">
        <RowPriority
          issue={issue}
          options={priorityOptions}
          disabled={disabled}
          onFocus={focus}
        />
        {!hidden.has("project") && issue.project !== null && (
          <span className="muted">{issue.project.name}</span>
        )}
        {!hidden.has("due") && (
          <RowDue
            issue={issue}
            disabled={disabled}
            onFocus={focus}
            open={(anchor) => {
              pickDue([issue.identifier], anchor);
            }}
          />
        )}
        <SubIssueBadge
          done={issue.completedChildCount}
          total={issue.childCount}
        />
        <span className="spacer" />
        {issue.voteCount > 0 && (
          <span className="muted">
            <ThumbsUp size={12} aria-hidden="true" />
            {issue.voteCount}
            <span className="sr-only"> votes</span>
          </span>
        )}
        {!hidden.has("assignee") && (
          <RowAssignee issue={issue} disabled={disabled} onFocus={focus} />
        )}
      </div>
    </article>
  );
}

function Column({
  state,
  items,
  options,
}: {
  state: BootstrapData["states"][number];
  items: Issue[];
  options: CardOptions;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: state.id,
    data: { stateId: state.id, column: true },
  });
  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? "over" : ""}`}
      aria-label={state.name}
    >
      <h2>
        <StateIcon type={state.type} color={state.color} />
        {state.name}
        <span className="count">{items.length}</span>
      </h2>
      <SortableContext
        items={items.map(({ id }) => id)}
        strategy={verticalListSortingStrategy}
      >
        {items.map((issue) => (
          <Card issue={issue} key={issue.id} options={options} />
        ))}
      </SortableContext>
      {items.length === 0 && (
        <div className="column-empty">
          <MessageSquare size={18} />
          <span>No issues</span>
        </div>
      )}
    </section>
  );
}

export function Board({
  items,
  states,
}: {
  items: Issue[];
  states: BootstrapData["states"];
}) {
  const { bootstrap } = useShell();
  const [params] = useSearchParams();
  const hidden = readDisplay(params).hidden;
  const statusChoices = useMemo(
    () =>
      stateOptions(
        [...states].sort(
          (a, b) => a.position - b.position || a.id.localeCompare(b.id),
        ),
      ),
    [states],
  );
  const options: CardOptions = {
    states: statusChoices,
    hidden,
    disabled: !bootstrap.writesEnabled,
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(BoardKeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
    }),
  );
  // A drop moves the card in the cache at once; moves of one card are saved
  // in order, so the board never has to wait for the previous one.
  function dropped(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const issue = items.find(({ id }) => id === active.id);
    const target = items.find(({ id }) => id === over.id);
    const state = states.find(({ id }) => id === (target?.state.id ?? over.id));
    if (issue === undefined || state === undefined) return;
    const column = items
      .filter((item) => item.state.id === state.id && item.id !== issue.id)
      .sort((a, b) => a.boardOrder - b.boardOrder || a.id.localeCompare(b.id));
    const index =
      target === undefined
        ? column.length
        : column.findIndex(({ id }) => id === target.id);
    const before = column[index - 1];
    const after = column[index];
    void moveIssue(issue.identifier, {
      stateId: state.id,
      boardOrder:
        before === undefined
          ? (after?.boardOrder ?? 2048) - 1024
          : after === undefined
            ? before.boardOrder + 1024
            : (before.boardOrder + after.boardOrder) / 2,
      ...(before === undefined ? {} : { beforeId: before.id }),
      ...(after === undefined ? {} : { afterId: after.id }),
    });
  }
  return (
    <>
      <DndContext
        sensors={sensors}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${items.find((item) => item.id === active.id)?.identifier ?? String(active.id)}`,
            onDragOver: ({ over }) =>
              over === null
                ? "Outside board"
                : `Dragging over ${states.find((state) => state.id === over.data.current?.["stateId"])?.name ?? "board"}`,
            onDragEnd: () => "Saving board position",
            onDragCancel: () => "Move canceled",
          },
        }}
        autoScroll={{ threshold: { x: 0.05, y: 0.05 }, acceleration: 5 }}
        collisionDetection={boardCollision}
        onDragEnd={dropped}
      >
        <div className="board">
          {states.map((state) => (
            <Column
              key={state.id}
              state={state}
              options={options}
              items={items
                .filter((item) => item.state.id === state.id)
                .sort(
                  (a, b) =>
                    a.boardOrder - b.boardOrder || a.id.localeCompare(b.id),
                )}
            />
          ))}
        </div>
      </DndContext>
    </>
  );
}
