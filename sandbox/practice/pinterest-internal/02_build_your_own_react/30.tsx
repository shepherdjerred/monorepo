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

type TextElement = {
  type: "TEXT_ELEMENT"
  props: Props
}

type HostElement = {
  type: string
  props: Props
}

type DidactElement = TextElement | HostElement

type ElementType = HostElement["type"] | "TEXT_ELEMENT"

type EffectTag = "PLACEMENT" | "UPDATE" | "DELETION"

type Fiber = {
  type?: ElementType
  props: Props
  dom: Node | null
  parent?: Fiber | null
  child?: Fiber | null
  sibling?: Fiber | null
  alternate?: Fiber | null
  effectTag?: EffectTag
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

function parentDom(fiber: Fiber): Node {
  const parent = fiber.parent
  if (parent?.dom == null)
    throw new Error("missing parent DOM")
  return parent.dom
}

function appendNode(
  parent: Node,
  child: Node | null | undefined
): void {
  if (child == null) throw new Error("missing DOM node")
  parent.appendChild(child)
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

  const isProperty = (key: string): key is AttributeName =>
    isAttribute(key)
  Object.keys(fiber.props)
    .filter(isProperty)
    .forEach(name => {
      assignProperty(dom, name, fiber.props[name])
    })

  return dom
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
  const domParent = parentDom(fiber)
  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    appendNode(domParent, fiber.dom)
  }

  commitWork(fiber.child)
  commitWork(fiber.sibling)
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
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }

  const elements = fiber.props.children
  reconcileChildren(fiber, elements)

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
  render
}

/** @jsx Didact.createElement */
const element = (
  <div id="foo">
    <a>bar</a>
    <b />
  </div>
)
const container = document.getElementById("root")
if (container == null) throw new Error("missing #root")
Didact.render(element, container)
