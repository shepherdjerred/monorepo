import { useNavigate } from "react-router";
import { useShortcuts } from "#client/shell/shortcuts.ts";
import type { CanvasCamera } from "./use-camera.ts";
import { ZOOM_STEP } from "./use-camera.ts";
import type { Tool } from "./gestures.ts";

type Keys = {
  readonly camera: CanvasCamera;
  /** The one selected frame, if exactly one is. */
  readonly onlyId: string | null;
  readonly placing: boolean;
  readonly activeId: string | null;
  readonly commentMode: boolean;
  readonly tool: Tool;
  readonly setTool: (update: (current: Tool) => Tool) => void;
  readonly toggleComment: () => void;
  readonly activate: (id: string) => void;
  readonly cancelPlacement: () => void;
  readonly deactivate: () => void;
  readonly leaveComment: () => void;
  readonly clearSelection: () => void;
};

/** The canvas's own keys: 1 2 0 + - fit and zoom, H hand, C comment, F focus, Enter live, Esc back out. */
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
    {
      key: "h",
      run: () => {
        keys.setTool((current) => (current === "hand" ? "select" : "hand"));
      },
    },
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
        if (keys.onlyId === null) return;
        event.preventDefault();
        keys.activate(keys.onlyId);
      },
    },
    {
      key: "Escape",
      run: () => {
        if (keys.placing) keys.cancelPlacement();
        else if (keys.activeId !== null) keys.deactivate();
        else if (keys.commentMode) keys.leaveComment();
        else if (keys.tool === "hand") keys.setTool(() => "select");
        else keys.clearSelection();
      },
    },
  ]);
}
