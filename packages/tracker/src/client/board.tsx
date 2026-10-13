import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
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
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { GripVertical, MessageSquare, ThumbsUp } from "lucide-react";
import { api, refresh, type BootstrapData, type Issue } from "./api.ts";
import { currentActor } from "./identity.ts";
import { Avatar, ErrorNotice, Priority, StateDot } from "./ui.tsx";

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

function Card({ issue }: { issue: Issue }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { stateId: issue.state.id } });
  return (
    <article
      ref={setNodeRef}
      className={`board-card ${isDragging ? "dragging" : ""}`}
      style={{
        transform:
          transform === null
            ? undefined
            : `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)`,
        transition,
      }}
    >
      <div className="card-top">
        <span className="identifier">{issue.identifier}</span>
        <button
          className="drag-handle"
          aria-label={`Move ${issue.identifier}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
      </div>
      <Link className="card-title" to={`/issues/${issue.identifier}`}>
        {issue.title}
      </Link>
      <div className="card-labels">
        {issue.labels.map((l) => (
          <span className="label" key={l.id}>
            <i style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
      <div className="card-bottom">
        <Priority value={issue.priority} />
        {issue.project !== null && (
          <span className="muted">{issue.project.name}</span>
        )}
        <span className="spacer" />
        {issue.voteCount > 0 && (
          <span className="muted">
            <ThumbsUp size={12} />
            {issue.voteCount}
          </span>
        )}
        {issue.assignee !== null && <Avatar actor={issue.assignee} />}
      </div>
    </article>
  );
}

function Column({
  state,
  items,
}: {
  state: BootstrapData["states"][number];
  items: Issue[];
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
        <StateDot color={state.color} />
        {state.name}
        <span className="count">{items.length}</span>
      </h2>
      <SortableContext
        items={items.map(({ id }) => id)}
        strategy={verticalListSortingStrategy}
      >
        {items.map((issue) => (
          <Card issue={issue} key={issue.id} />
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
  const [optimistic, setOptimistic] = useState<Issue[]>();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
    }),
  );
  const move = useMutation({
    mutationFn: (input: Parameters<typeof api.issues.move.mutate>[0]) =>
      api.issues.move.mutate(input),
    onSettled: async () => {
      await refresh();
      setOptimistic(undefined);
    },
  });
  const visible = optimistic ?? items;
  function dropped(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id || move.isPending) return;
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
    setOptimistic(
      items.map((item) =>
        item.id === issue.id
          ? {
              ...item,
              state,
              stateId: state.id,
              boardOrder:
                before === undefined
                  ? (after?.boardOrder ?? 2048) - 1024
                  : after === undefined
                    ? before.boardOrder + 1024
                    : (before.boardOrder + after.boardOrder) / 2,
            }
          : item,
      ),
    );
    move.mutate({
      actor: currentActor(),
      identifier: issue.identifier,
      stateId: state.id,
      expectedRevision: issue.revision,
      ...(before === undefined ? {} : { beforeId: before.id }),
      ...(after === undefined ? {} : { afterId: after.id }),
    });
  }
  return (
    <>
      {move.error !== null && <ErrorNotice error={move.error} />}
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
              items={visible
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
