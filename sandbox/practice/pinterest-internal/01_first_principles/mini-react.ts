// A synchronous subset of React, big enough to see the real model:
// elements are data, render is a pure diff, commit touches the host tree,
// and hooks are an array indexed by call order.

export type Props = Record<string, unknown>;

type Component = (props: Props) => VNode;

type ElementType = string | Component;

export type VNode = {
  type: ElementType;
  key: string | number | null;
  props: Props & { children: VNode[] };
};

type Effect = "placement" | "update";

type Hook = {
  state: unknown;
  queue: Array<unknown>;
};

type Fiber = {
  type: ElementType;
  key: string | number | null;
  props: VNode["props"];
  dom: DomNode | null;
  child: Fiber | null;
  sibling: Fiber | null;
  parent: Fiber | null;
  alternate: Fiber | null;
  effectTag?: Effect;
  hooks: Hook[];
};

export type DomNode = {
  kind: "element" | "text";
  type: string;
  props: Props;
  children: DomNode[];
};

const trace: string[] = [];

let currentRoot: Fiber | null = null;
let wipFiber: Fiber | null = null;
let hookIndex = 0;
let rendering = false;
const deletions: Fiber[] = [];

function log(message: string) {
  trace.push(message);
}

export function takeTrace(): string[] {
  return trace.splice(0, trace.length);
}

export function createContainer(): DomNode {
  return { kind: "element", type: "ROOT", props: {}, children: [] };
}

function textElement(text: string): VNode {
  return {
    type: "TEXT",
    key: null,
    props: { nodeValue: text, children: [] },
  };
}

export function h(
  type: ElementType,
  props: Props | null,
  ...children: Array<VNode | string | number | boolean | null | undefined>
): VNode {
  const key =
    props && "key" in props ? (props.key as string | number | null) : null;
  const rest: Props = { ...props };
  delete rest.key;

  const normalized = children.flatMap((child) => {
    if (child == null || typeof child === "boolean") return [];
    if (typeof child === "object") return [child];
    return [textElement(String(child))];
  });

  return {
    type,
    key,
    props: { ...rest, children: normalized },
  };
}

export function useState<T>(
  initial: T,
): [T, (action: T | ((previous: T) => T)) => void] {
  const fiber = wipFiber;
  if (!fiber) {
    throw new Error("useState only works while a component is rendering");
  }

  const previous = fiber.alternate?.hooks[hookIndex] as Hook | undefined;
  const hook: Hook = {
    state: previous ? previous.state : initial,
    queue: [],
  };

  for (const action of previous?.queue ?? []) {
    hook.state =
      typeof action === "function"
        ? (action as (previous: T) => T)(hook.state as T)
        : action;
  }

  log(
    `  hook[${hookIndex}] = ${JSON.stringify(hook.state)} (${previous ? "update" : "mount"})`,
  );

  const setState = (action: T | ((previous: T) => T)) => {
    if (rendering) {
      throw new Error(
        "setState during render restarts the render; left out of this model",
      );
    }
    // The queue lives on the hook from the render that created this setter.
    // The next render finds it through fiber.alternate.
    hook.queue.push(action);
    scheduleRerender();
  };

  fiber.hooks.push(hook);
  hookIndex += 1;
  return [hook.state as T, setState];
}

export function render(element: VNode, container: DomNode) {
  const root: Fiber = {
    type: "ROOT",
    key: null,
    props: { children: [element] },
    dom: container,
    child: null,
    sibling: null,
    parent: null,
    alternate: currentRoot,
    hooks: [],
  };
  deletions.length = 0;
  work(root);
  commit(root);
  currentRoot = root;
}

function scheduleRerender() {
  if (!currentRoot?.dom) {
    throw new Error("setState before the tree was mounted");
  }
  render(currentRoot.props.children[0]!, currentRoot.dom);
}

function work(root: Fiber) {
  rendering = true;
  try {
    let next: Fiber | null = root;
    while (next) next = performUnit(next);
  } finally {
    rendering = false;
  }
}

function performUnit(fiber: Fiber): Fiber | null {
  if (typeof fiber.type === "function") {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) return fiber.child;
  let cursor: Fiber | null = fiber;
  while (cursor) {
    if (cursor.sibling) return cursor.sibling;
    cursor = cursor.parent;
  }
  return null;
}

function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = [];
  const type = fiber.type as Component;
  log(`render <${type.name || "Anonymous"}>`);
  reconcileChildren(fiber, [type(fiber.props)]);
}

function updateHostComponent(fiber: Fiber) {
  if (!fiber.dom && fiber.type !== "ROOT") {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

function reconcileChildren(parent: Fiber, elements: VNode[]) {
  const previousChildren: Fiber[] = [];
  let cursor = parent.alternate?.child ?? null;
  while (cursor) {
    previousChildren.push(cursor);
    cursor = cursor.sibling;
  }

  const used = new Set<Fiber>();
  let firstChild: Fiber | null = null;
  let previousSibling: Fiber | null = null;

  elements.forEach((element, index) => {
    const match = findMatch(previousChildren, element, index, used);
    const sameType = match?.type === element.type;
    const fiber: Fiber = {
      type: element.type,
      key: element.key,
      props: element.props,
      dom: sameType ? match.dom : null,
      child: null,
      sibling: null,
      parent,
      alternate: sameType ? match : null,
      effectTag: sameType ? "update" : "placement",
      hooks: [],
    };

    if (match && !sameType) {
      used.add(match);
      deletions.push(match);
    }
    if (match && sameType) used.add(match);

    if (index === 0) firstChild = fiber;
    else if (previousSibling) previousSibling.sibling = fiber;
    previousSibling = fiber;
  });

  for (const previous of previousChildren) {
    if (!used.has(previous)) deletions.push(previous);
  }

  parent.child = firstChild;
}

function findMatch(
  previousChildren: Fiber[],
  element: VNode,
  index: number,
  used: Set<Fiber>,
): Fiber | undefined {
  const match =
    element.key != null
      ? previousChildren.find((fiber) => fiber.key === element.key)
      : previousChildren[index];
  if (!match || used.has(match)) return undefined;
  return match;
}

function createDom(fiber: Fiber): DomNode {
  const isText = fiber.type === "TEXT";
  const node: DomNode = {
    kind: isText ? "text" : "element",
    type: isText ? "TEXT" : String(fiber.type),
    props: {},
    children: [],
  };
  updateDom(node, {}, fiber.props);
  return node;
}

function updateDom(dom: DomNode, previous: Props, next: Props) {
  for (const key of Object.keys(previous)) {
    if (key !== "children" && !(key in next)) delete dom.props[key];
  }
  for (const [key, value] of Object.entries(next)) {
    if (key !== "children") dom.props[key] = value;
  }
}

function commit(root: Fiber) {
  for (const fiber of deletions) commitDeletion(fiber);
  commitWork(root.child);
}

function commitWork(fiber: Fiber | null) {
  if (!fiber) return;

  if (fiber.effectTag === "placement" && fiber.dom) {
    insertDom(fiber, fiber.dom);
    log(`commit place ${describe(fiber.dom)}`);
  } else if (fiber.effectTag === "update" && fiber.dom) {
    const previous = fiber.alternate?.props ?? {};
    if (
      fiber.dom.kind === "text" &&
      previous.nodeValue !== fiber.props.nodeValue
    ) {
      log(
        `commit update text "${String(previous.nodeValue)}" -> "${String(fiber.props.nodeValue)}"`,
      );
    }
    updateDom(fiber.dom, previous, fiber.props);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber: Fiber) {
  if (fiber.dom) {
    const parent = hostParent(fiber);
    parent.children = parent.children.filter((child) => child !== fiber.dom);
    log(`commit delete ${describe(fiber.dom)}`);
    return;
  }
  let child = fiber.child;
  while (child) {
    commitDeletion(child);
    child = child.sibling;
  }
}

function insertDom(fiber: Fiber, dom: DomNode) {
  const parent = hostParent(fiber);
  const before = nextHostInSameParent(fiber, parent);
  const index = before ? parent.children.indexOf(before) : -1;
  if (index === -1) parent.children.push(dom);
  else parent.children.splice(index, 0, dom);
}

function nextHostInSameParent(fiber: Fiber, parent: DomNode): DomNode | null {
  let cursor: Fiber | null = fiber;
  while (cursor) {
    let sibling = cursor.sibling;
    while (sibling) {
      const found = firstHostDescendant(sibling, parent);
      if (found) return found;
      sibling = sibling.sibling;
    }
    if (cursor.parent?.dom === parent) break;
    cursor = cursor.parent;
  }
  return null;
}

function firstHostDescendant(fiber: Fiber, parent: DomNode): DomNode | null {
  if (
    fiber.dom &&
    fiber.effectTag !== "placement" &&
    hostParent(fiber) === parent
  ) {
    return fiber.dom;
  }
  let child = fiber.child;
  while (child) {
    const found = firstHostDescendant(child, parent);
    if (found) return found;
    child = child.sibling;
  }
  return null;
}

function hostParent(fiber: Fiber): DomNode {
  let parent = fiber.parent;
  while (parent && !parent.dom) parent = parent.parent;
  if (!parent?.dom) throw new Error("host node has no parent");
  return parent.dom;
}

function describe(node: DomNode): string {
  if (node.kind === "text") return `text "${String(node.props.nodeValue)}"`;
  return `<${node.type}>`;
}

export function serialize(node: DomNode): string {
  if (node.kind === "text") return String(node.props.nodeValue ?? "");
  const inner = node.children.map(serialize).join("");
  if (node.type === "ROOT") return inner;
  return `<${node.type}>${inner}</${node.type}>`;
}
