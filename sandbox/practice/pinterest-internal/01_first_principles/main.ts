import {
  createContainer,
  h,
  render,
  serialize,
  takeTrace,
  useState,
} from "./mini-react.ts";

function Counter() {
  const [count, setCount] = useState(0);
  const [label] = useState("pins");
  return h(
    "button",
    { onClick: () => setCount((value) => value + 1) },
    `${label}: ${count}`,
  );
}

function Greeter() {
  const [count, setCount] = useState(1);
  return h(
    "button",
    { onClick: () => setCount((value) => value + 1) },
    `hello ${count}`,
  );
}

function Switcher() {
  const [showCounter, setShowCounter] = useState(true);
  return h(
    "div",
    null,
    showCounter ? h(Counter, null) : h(Greeter, null),
    h("button", { onClick: () => setShowCounter((value) => !value) }, "flip"),
  );
}

function click(container: ReturnType<typeof createContainer>, label: string) {
  const button = findButton(container, label);
  if (!button) throw new Error(`button not found: ${label}`);
  const onClick = button.props.onClick;
  if (typeof onClick !== "function") throw new Error(`no handler for ${label}`);
  onClick();
}

function findButton(
  node: ReturnType<typeof createContainer>,
  label: string,
): ReturnType<typeof createContainer> | undefined {
  if (node.type === "button" && serialize(node).includes(label)) return node;
  for (const child of node.children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return undefined;
}

function scene(
  title: string,
  run: (container: ReturnType<typeof createContainer>) => void,
) {
  console.log(`\n== ${title}`);
  const container = createContainer();
  run(container);
  console.log(serialize(container));
}

scene("mount, then click", (container) => {
  render(h(Counter, null), container);
  console.log(takeTrace().join("\n"));
  console.log(serialize(container));

  click(container, "pins");
  console.log(takeTrace().join("\n"));
});

scene("swapping the child type resets its state", (container) => {
  render(h(Switcher, null), container);
  takeTrace();
  console.log(serialize(container));

  click(container, "flip");
  console.log(takeTrace().join("\n"));
});
