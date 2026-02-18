import type { KeyboardKey } from "@discord-plays-pokemon/common";
import useKeyboardJs from "react-use/lib/useKeyboardJs";

export function Key({
  keyboardKey: { display, key, api },
  onKeyDown,
}: {
  keyboardKey: KeyboardKey;
  onKeyDown: () => void;
}) {
  const [isPressed, event] = useKeyboardJs(key);
  event?.preventDefault();
  if (isPressed) {
    onKeyDown();
  }
  return (
    <kbd
      className={`p-3 bg-slate-600 block text-center m-1 ${isPressed ? `bg-slate-400` : ``}`}
    >
      {display} ({api})
    </kbd>
  );
}
