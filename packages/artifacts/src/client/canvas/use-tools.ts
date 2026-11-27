import { useCallback, useState } from "react";
import type { Tool } from "./gestures.ts";

/**
 * Which tool is active: select, hand, or comment mode (which is exclusive with
 * both). Entering a mode drops what belongs to the one before: a half-written
 * comment, or the live frame.
 */
export function useToolModes(drop: {
  readonly placement: () => void;
  readonly live: () => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [commentMode, setCommentMode] = useState(false);
  const { placement, live } = drop;

  const selectTool = useCallback(() => {
    setTool("select");
    setCommentMode(false);
    placement();
  }, [placement]);
  const handTool = useCallback(() => {
    setTool("hand");
    setCommentMode(false);
    placement();
  }, [placement]);
  const toggleComment = useCallback(() => {
    setCommentMode((on) => !on);
    live();
    placement();
  }, [live, placement]);
  const toggleHand = useCallback(() => {
    if (tool === "hand") selectTool();
    else handTool();
  }, [tool, selectTool, handTool]);
  const leaveComment = useCallback(() => {
    setCommentMode(false);
  }, []);
  return {
    tool,
    commentMode,
    selectTool,
    handTool,
    toggleHand,
    toggleComment,
    leaveComment,
  };
}
