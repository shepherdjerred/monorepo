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

function render(
  element: DidactElement,
  container: Node
): void {
  wipRoot = {
    dom: container,
    props: {
      children: [element]
    }
  }
  nextUnitOfWork = wipRoot
}

let nextUnitOfWork: Fiber | null | undefined = null
let wipRoot: Fiber | null = null

function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
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
  let index = 0
  let prevSibling: Fiber | null = null

  while (index < elements.length) {
    const element = elements[index]

    const newFiber = {
      type: element.type,
      props: element.props,
      parent: fiber,
      dom: null
    }

    if (index === 0) {
      fiber.child = newFiber
    } else {
      if (prevSibling == null)
        throw new Error("missing previous sibling")
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
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
