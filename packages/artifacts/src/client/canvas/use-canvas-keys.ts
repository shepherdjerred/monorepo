import { useNavigate } from "react-router";
import { useShortcuts } from "#client/shell/shortcuts.ts";
import type { CanvasCamera } from "./use-camera.ts";
import { ZOOM_STEP } from "./use-camera.ts";
import type { Tool } from "./gestures.ts";

const DRAWING_KEYS: readonly (readonly [string, Tool])[] = [
  ["t", "text"],
  ["s", "sticky"],
  ["p", "pen"],
  ["b", "box"],
  ["a", "arrow"],
  ["l", "line"],
];

type Keys = {
  readonly camera: CanvasCamera;
  /** The one selected frame, if exactly one is. */
  readonly onlyId: string | null;
  readonly placing: boolean;
  readonly activeId: string | null;
  readonly commentMode: boolean;
  readonly tool: Tool;
  readonly selectTool: () => void;
  readonly pickTool: (tool: Tool) => void;
  /** Enter: interact with the selected frame, or edit the selected annotation's text. */
  readonly onEnter: () => void;
  readonly toggleHand: () => void;
  readonly toggleComment: () => void;
  readonly cancelPlacement: () => void;
  readonly deactivate: () => void;
  readonly leaveComment: () => void;
  readonly clearSelection: () => void;
};

/** The canvas's own keys: 1 2 0 + - fit and zoom, V select, H hand, C comment, F focus, Enter live, Esc back out. */
export function useCanvasKeys(keys: Keys): void {
  const navigate = useNavigate();
  const { camera } = keys;
  useShortcuts([
    { key: "1", run: camera.fitAll },
    { key: "2", run: camera.fitSelection },
    { key: "0", run: camera.reset },
    {
      key: "=",
      run: () => {
        camera.zoomBy(ZOOM_STEP);
      },
    },
    {
      key: "+",
      run: () => {
        camera.zoomBy(ZOOM_STEP);
      },
    },
    {
      key: "-",
      run: () => {
        camera.zoomBy(1 / ZOOM_STEP);
      },
    },
    { key: "v", run: keys.selectTool },
    ...DRAWING_KEYS.map(([key, tool]) => ({
      key,
      run: () => {
        keys.pickTool(tool);
      },
    })),
    { key: "h", run: keys.toggleHand },
    { key: "c", run: keys.toggleComment },
    {
      key: "f",
      run: () => {
        if (keys.onlyId !== null) void navigate(`/a/${keys.onlyId}`);
      },
    },
    {
      key: "Enter",
      run: (event) => {
        event.preventDefault();
        keys.onEnter();
      },
    },
    {
      key: "Escape",
      run: () => {
        if (keys.placing) keys.cancelPlacement();
        else if (keys.activeId !== null) keys.deactivate();
        else if (keys.commentMode) keys.leaveComment();
        else if (keys.tool === "select") keys.clearSelection();
        else keys.selectTool();
      },
    },
  ]);
}
