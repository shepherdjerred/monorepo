/** @jsx Didact.createElement */
export {}

// Typed adaptation of Rodrigo Pombo’s Build your own React (2019).
type EventName = `on${string}`

type AttributeName = "id" | "title" | "name" | "nodeValue"

type Props = {
  children: DidactElement[]
  nodeValue?: string
  id?: string
  title?: string
  name?: string
} & { [event in EventName]?: EventListener }

type InputProps = Omit<Props, "children">

type Component = (props: Props) => DidactElement

type TextElement = {
  type: "TEXT_ELEMENT"
  props: Props
}

type HostElement = {
  type: string
  props: Props
}

type ComponentElement = {
  type: Component
  props: Props
}

type DidactElement =
  TextElement | HostElement | ComponentElement

type ElementType =
  HostElement["type"] | "TEXT_ELEMENT" | Component

type EffectTag = "PLACEMENT" | "UPDATE" | "DELETION"

type Hook<T> = {
  state: T
  queue: Array<(previous: T) => T>
}

type Fiber = {
  type?: ElementType
  props: Props
  dom: Node | null
  parent?: Fiber | null
  child?: Fiber | null
  sibling?: Fiber | null
  alternate?: Fiber | null
  effectTag?: EffectTag
  hooks?: unknown[]
}

function isAttribute(key: string): key is AttributeName {
  return (
    key === "id" ||
    key === "title" ||
    key === "name" ||
    key === "nodeValue"
  )
}

function isElementNode(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

function readProp(props: Props, key: string): unknown {
  if (key === "children") return props.children
  if (isAttribute(key) || key === "name" || isEvent(key))
    return props[key]
  return undefined
}

function assignProperty(
  dom: Node,
  name: string,
  value: unknown
): void {
  if (!isAttribute(name)) return
  const text = value == null ? "" : String(value)
  if (name === "nodeValue") {
    dom.nodeValue = text
    return
  }
  if (isElementNode(dom)) dom.setAttribute(name, text)
}

function readListener(
  props: Props,
  name: string
): EventListener {
  if (!isEvent(name))
    throw new Error(`not an event: ${name}`)
  const handler = props[name]
  if (handler == null) throw new Error(`missing ${name}`)
  return handler
}

function alternateProps(fiber: Fiber): Props {
  if (fiber.alternate == null)
    throw new Error("update without alternate")
  return fiber.alternate.props
}

function appendNode(
  parent: Node,
  child: Node | null | undefined
): void {
  if (child == null) throw new Error("missing DOM node")
  parent.appendChild(child)
}

function readHook<T>(
  hooks: unknown[] | undefined,
  index: number
): Hook<T> | undefined {
  const slot = hooks?.[index]
  if (slot == null) return undefined
  return slot as Hook<T>
}

function callComponent(fiber: Fiber): DidactElement {
  if (typeof fiber.type !== "function")
    throw new Error("not a function component")
  return fiber.type(fiber.props)
}

function hostNode(fiber: Fiber): HTMLElement | Text {
  if (fiber.type === "TEXT_ELEMENT") {
    const node = document.createTextNode("")
    return node
  }
  if (typeof fiber.type !== "string")
    throw new Error("host fiber is missing a tag")
  return document.createElement(fiber.type)
}

const isEvent = (key: string): key is EventName =>
  key.startsWith("on")

declare namespace Didact {
  namespace JSX {
    type Element = DidactElement
    interface IntrinsicElements
      extends globalThis.JSX.IntrinsicElements {}
  }
}

// @lesson-start
function createElement(
  type: ElementType,
  props?: InputProps | null,
  ...children: Array<DidactElement | string | number>
): DidactElement {
  const childElements = children.map(child =>
    typeof child === "object"
      ? child
      : createTextElement(child)
  )
  const nextProps: Props = {
    ...props,
    children: childElements
  }
  if (typeof type === "function")
    return { type, props: nextProps }
  if (type === "TEXT_ELEMENT") return createTextElement("")
  return { type, props: nextProps }
}

function createTextElement(
  text: string | number
): TextElement {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: String(text),
      children: []
    }
  }
}

function createDom(fiber: Fiber): HTMLElement | Text {
  const dom = hostNode(fiber)

  updateDom(dom, { children: [] }, fiber.props)

  return dom
}

const isProperty = (key: string): key is AttributeName =>
  isAttribute(key)
const isNew =
  (prev: Props, next: Props) =>
  (key: string): boolean =>
    readProp(prev, key) !== readProp(next, key)
const isGone =
  (prev: Props, next: Props) =>
  (key: string): boolean =>
    !(key in next)
function updateDom(
  dom: Node,
  prevProps: Props,
  nextProps: Props
): void {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(
      key =>
        !(key in nextProps) ||
        isNew(prevProps, nextProps)(key)
    )
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2)
      dom.removeEventListener(
        eventType,
        readListener(prevProps, name)
      )
    })

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      assignProperty(dom, name, "")
    })

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      assignProperty(dom, name, readProp(nextProps, name))
    })

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2)
      dom.addEventListener(
        eventType,
        readListener(nextProps, name)
      )
    })
}

function commitRoot(): void {
  deletionList().forEach(commitWork)
  commitWork(wipRoot?.child)
  currentRoot = wipRoot
  wipRoot = null
}

function commitWork(fiber: Fiber | null | undefined): void {
  if (!fiber) {
    return
  }

  let domParentFiber = fiber.parent
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent
  }
  if (domParentFiber?.dom == null)
    throw new Error("missing host parent")
  const domParent = domParentFiber.dom

  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    appendNode(domParent, fiber.dom)
  } else if (
    fiber.effectTag === "UPDATE" &&
    fiber.dom != null
  ) {
    updateDom(fiber.dom, alternateProps(fiber), fiber.props)
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent)
    // Deletions are visited separately; never traverse stale siblings.
    return
  }

  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function commitDeletion(
  fiber: Fiber | null,
  domParent: Node
): void {
  if (fiber == null) return
  if (fiber.dom) {
    domParent.removeChild(fiber.dom)
  } else {
    commitDeletion(fiber.child ?? null, domParent)
  }
}

function render(
  element: DidactElement,
  container: Node
): void {
  wipRoot = {
    dom: container,
    props: {
      children: [element]
    },
    alternate: currentRoot
  }
  deletions = []
  nextUnitOfWork = wipRoot
}

let nextUnitOfWork: Fiber | null | undefined = null
let currentRoot: Fiber | null = null
let wipRoot: Fiber | null = null
let deletions: Fiber[] | null = null
function deletionList(): Fiber[] {
  if (deletions == null)
    throw new Error("deletions is unset")
  return deletions
}

function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  requestIdleCallback(workLoop)
}

requestIdleCallback(workLoop)

function performUnitOfWork(
  fiber: Fiber
): Fiber | null | undefined {
  const isFunctionComponent =
    typeof fiber.type === "function"
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)
  } else {
    updateHostComponent(fiber)
  }
  if (fiber.child) {
    return fiber.child
  }
  let nextFiber: Fiber | null | undefined = fiber
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling
    }
    nextFiber = nextFiber.parent
  }
  return null
}

let wipFiber: Fiber | null = null
let hookIndex = 0

function updateFunctionComponent(fiber: Fiber): void {
  wipFiber = fiber
  hookIndex = 0
  wipFiber.hooks = []
  const children = [callComponent(fiber)]
  reconcileChildren(fiber, children)
}

function useState<T>(
  initial: T
): [T, (action: (previous: T) => T) => void] {
  if (wipFiber == null)
    throw new Error("useState outside render")
  const oldHook = readHook<T>(
    wipFiber.alternate?.hooks,
    hookIndex
  )
  const hook: Hook<T> = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  }
  const setState = (action: (previous: T) => T): void => {
    void action
    throw new Error("setState is added in the next pane")
  }
  if (wipFiber.hooks == null) wipFiber.hooks = []
  wipFiber.hooks.push(hook)
  hookIndex++
  return [hook.state, setState]
}

function updateHostComponent(fiber: Fiber): void {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }
  reconcileChildren(fiber, fiber.props.children)
}

function reconcileChildren(
  wipFiber: Fiber,
  elements: DidactElement[]
): void {
  let index = 0
  let oldFiber = wipFiber.alternate?.child ?? null
  let prevSibling: Fiber | null = null

  while (index < elements.length || oldFiber != null) {
    const element = elements[index]
    let newFiber: Fiber | null = null

    const sameType =
      oldFiber && element && element.type == oldFiber.type

    if (sameType && oldFiber && element) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE"
      }
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT"
      }
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION"
      deletionList().push(oldFiber)
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling ?? null
    }

    if (index === 0) {
      wipFiber.child = newFiber
    } else if (element) {
      if (prevSibling == null)
        throw new Error("missing previous sibling")
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }
}

const Didact = {
  createElement,
  render,
  useState
}

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1)
  return (
    <h1 onClick={() => setState(c => c + 1)}>
      Count: {state}
    </h1>
  )
}
const element = <Counter />
const container = document.getElementById("root")
if (container == null) throw new Error("missing #root")
Didact.render(element, container)
