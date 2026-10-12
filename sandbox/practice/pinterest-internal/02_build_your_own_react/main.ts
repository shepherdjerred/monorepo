export {}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
globalThis.Node = { ELEMENT_NODE, TEXT_NODE } as typeof Node

type Listener = (event: Event) => void

class HostNode {
  readonly nodeType: number
  readonly nodeName: string
  nodeValue: string | null
  id = ""
  title = ""
  readonly children: HostNode[] = []
  private readonly listeners = new Map<
    string,
    Set<Listener>
  >()

  constructor(
    nodeType: number,
    nodeName: string,
    nodeValue: string | null = null
  ) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.nodeValue = nodeValue
  }

  appendChild(child: HostNode): HostNode {
    this.children.push(child)
    return child
  }

  removeChild(child: HostNode): HostNode {
    const index = this.children.indexOf(child)
    if (index === -1)
      throw new Error("child is not in this parent")
    this.children.splice(index, 1)
    return child
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(
    type: string,
    listener: Listener
  ): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new Event(type))
  }
}

const root = new HostNode(ELEMENT_NODE, "div")
const callbacks: IdleRequestCallback[] = []

globalThis.document = {
  createElement(tag: string) {
    return new HostNode(ELEMENT_NODE, tag)
  },
  createTextNode(text: string) {
    return new HostNode(TEXT_NODE, "#text", text)
  },
  getElementById(id: string) {
    if (id !== "root") return null
    return root
  }
} as unknown as Document

globalThis.requestIdleCallback = callback => {
  callbacks.push(callback)
  return callbacks.length
}

function flush(): void {
  const callback = callbacks.shift()
  if (!callback) throw new Error("no idle work queued")
  callback({ didTimeout: false, timeRemaining: () => 50 })
}

function textOf(node: HostNode): string {
  if (node.nodeType === TEXT_NODE)
    return node.nodeValue ?? ""
  return node.children.map(textOf).join("")
}

function find(
  node: HostNode,
  name: string
): HostNode | undefined {
  if (node.nodeName === name) return node
  for (const child of node.children) {
    const found = find(child, name)
    if (found) return found
  }
  return undefined
}

await import("./50.tsx")
flush()
console.log(textOf(root))

const heading = find(root, "h1")
if (!heading) throw new Error("missing h1")
heading.dispatch("click")
flush()
console.log(textOf(root))
