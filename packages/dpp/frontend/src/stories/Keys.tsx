import { KeyboardKey } from "@shepherdjerred/dpp-common";
import { Card } from "./Card";
import { Key } from "./Key";
import lodash from "lodash";

export function Keys({ onKeyDown }: { onKeyDown: (key: string) => void }) {
  const keys: KeyboardKey[] = [
    { display: "A", key: "a", api: "a" },
    { display: "B", key: "b", api: "b" },
    { display: "Left", key: "left", api: "left" },
    { display: "Right", key: "right", api: "right" },
    { display: "Up", key: "up", api: "up" },
    { display: "Down", key: "down", api: "down" },
    { display: "Enter", key: "enter", api: "start" },
    { display: "Shift", key: "shift", api: "select" },
  ];
  const keyElements = lodash.map(keys, (key) => {
    return (
      <div key={key.key}>
        <Key keyboardKey={key} onKeyDown={() => onKeyDown(key.api)} />
      </div>
    );
  });

  return <Card title="Keys">{keyElements}</Card>;
}
