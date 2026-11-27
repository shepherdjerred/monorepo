import {
  HandIcon,
  MoveUpRightIcon,
  PencilIcon,
  SlashIcon,
  SquareIcon,
  StickyNoteIcon,
  TypeIcon,
  MaximizeIcon,
  MessageCircleIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  ScanIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { CameraController } from "./controller.ts";
import type { Tool } from "./gestures.ts";

const ICON_STROKE = 1.5;
const ICON_SIZE = 20;

/** The zoom readout follows the camera without a render per frame. */
function ZoomReadout({
  controller,
  onReset,
}: {
  readonly controller: CameraController;
  readonly onReset: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const show = (): void => {
      const element = ref.current;
      if (element !== null)
        element.textContent = `${String(Math.round(controller.get().s * 100))}%`;
    };
    show();
    return controller.onFrame(show);
  }, [controller]);
  return (
    <button
      ref={ref}
      type="button"
      className="ar-cv-zoom"
      title="Reset zoom to 100% (0)"
      aria-keyshortcuts="0"
      data-testid="zoom-readout"
      onClick={onReset}
    />
  );
}

export type ToolButton = {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  readonly Icon: LucideIcon;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testId?: string;
  /** Filled in the accent colour while active (the select arrow). */
  readonly filledWhenActive?: boolean;
};

function ToolButtonView({ tool }: { readonly tool: ToolButton }) {
  const { Icon } = tool;
  return (
    <button
      type="button"
      className="ar-cv-tool"
      aria-label={tool.label}
      aria-keyshortcuts={tool.shortcut}
      aria-pressed={tool.active}
      data-testid={tool.testId}
      data-filled={tool.filledWhenActive === true && tool.active}
      title={`${tool.label} (${tool.shortcut})`}
      onClick={tool.onPress}
    >
      <Icon
        aria-hidden="true"
        size={ICON_SIZE}
        strokeWidth={ICON_STROKE}
        fill={
          tool.filledWhenActive === true && tool.active
            ? "currentColor"
            : "none"
        }
      />
    </button>
  );
}

/**
 * The tool pill at the bottom centre: pointer tools, then the drawing tools of
 * `drawing` (annotations), then comment. A group with no tools is not drawn.
 */
export function ToolPill({
  groups,
}: {
  readonly groups: readonly (readonly ToolButton[])[];
}): React.JSX.Element {
  const shown = groups.filter((group) => group.length > 0);
  return (
    <div
      className="ar-cv-toolbar"
      role="toolbar"
      aria-label="Canvas tools"
      data-cv-ignore=""
    >
      {shown.map((group, at) => (
        <div key={group[0]?.id ?? at} className="ar-cv-group">
          {at === 0 ? null : <span className="ar-cv-sep" aria-hidden="true" />}
          {group.map((tool) => (
            <ToolButtonView key={tool.id} tool={tool} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Zoom and fit, in their own small pill at the bottom right. */
export function ZoomPill({
  controller,
  hasSelection,
  onZoom,
  onReset,
  onFitAll,
  onFitSelection,
}: {
  readonly controller: CameraController;
  readonly hasSelection: boolean;
  readonly onZoom: (factor: number) => void;
  readonly onReset: () => void;
  readonly onFitAll: () => void;
  readonly onFitSelection: () => void;
}): React.JSX.Element {
  return (
    <div
      className="ar-cv-zoompill"
      role="toolbar"
      aria-label="Zoom"
      data-cv-ignore=""
    >
      <button
        type="button"
        className="ar-cv-tool"
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        title="Zoom out (-)"
        onClick={() => {
          onZoom(1 / 1.25);
        }}
      >
        <MinusIcon
          aria-hidden="true"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
        />
      </button>
      <ZoomReadout controller={controller} onReset={onReset} />
      <button
        type="button"
        className="ar-cv-tool"
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        title="Zoom in (+)"
        onClick={() => {
          onZoom(1.25);
        }}
      >
        <PlusIcon
          aria-hidden="true"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
        />
      </button>
      <span className="ar-cv-sep" aria-hidden="true" />
      <button
        type="button"
        className="ar-cv-tool"
        aria-label="Fit all frames"
        aria-keyshortcuts="1"
        title="Fit all (1)"
        onClick={onFitAll}
      >
        <MaximizeIcon
          aria-hidden="true"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
        />
      </button>
      <button
        type="button"
        className="ar-cv-tool"
        aria-label="Fit the selected frame"
        aria-keyshortcuts="2"
        title="Fit selection (2)"
        disabled={!hasSelection}
        onClick={onFitSelection}
      >
        <ScanIcon
          aria-hidden="true"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
        />
      </button>
    </div>
  );
}

/** The tools every board has: select, hand, comment. */
export function pointerTools(state: {
  readonly tool: Tool;
  readonly commenting: boolean;
  readonly onSelect: () => void;
  readonly onHand: () => void;
}): { readonly pointer: readonly ToolButton[] } {
  return {
    pointer: [
      {
        id: "select",
        label: "Select tool",
        shortcut: "V",
        Icon: MousePointer2Icon,
        active: state.tool === "select" && !state.commenting,
        onPress: state.onSelect,
        filledWhenActive: true,
        testId: "tool-select",
      },
      {
        id: "hand",
        label: "Hand tool",
        shortcut: "H",
        Icon: HandIcon,
        active: state.tool === "hand" && !state.commenting,
        onPress: state.onHand,
        testId: "tool-hand",
      },
    ],
  };
}

export function commentTool(state: {
  readonly commenting: boolean;
  readonly onToggle: () => void;
}): ToolButton {
  return {
    id: "comment",
    label: "Comment mode",
    shortcut: "C",
    Icon: MessageCircleIcon,
    active: state.commenting,
    onPress: state.onToggle,
    testId: "comment-mode",
  };
}

const DRAWING: readonly {
  readonly tool: Tool;
  readonly label: string;
  readonly shortcut: string;
  readonly Icon: LucideIcon;
}[] = [
  { tool: "text", label: "Text tool", shortcut: "T", Icon: TypeIcon },
  {
    tool: "sticky",
    label: "Sticky note tool",
    shortcut: "S",
    Icon: StickyNoteIcon,
  },
  { tool: "pen", label: "Pen tool", shortcut: "P", Icon: PencilIcon },
  { tool: "box", label: "Box tool", shortcut: "B", Icon: SquareIcon },
  { tool: "arrow", label: "Arrow tool", shortcut: "A", Icon: MoveUpRightIcon },
  { tool: "line", label: "Line tool", shortcut: "L", Icon: SlashIcon },
];

/** The annotation tools: text, sticky, pen, box, arrow, line. */
export function drawingTools(state: {
  readonly tool: Tool;
  readonly commenting: boolean;
  readonly onPick: (tool: Tool) => void;
}): readonly ToolButton[] {
  return DRAWING.map((entry) => ({
    id: entry.tool,
    label: entry.label,
    shortcut: entry.shortcut,
    Icon: entry.Icon,
    active: state.tool === entry.tool && !state.commenting,
    onPress: () => {
      state.onPick(entry.tool);
    },
    testId: `tool-${entry.tool}`,
  }));
}
