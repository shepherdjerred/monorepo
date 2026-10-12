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

function render(
  element: DidactElement,
  container: Node
): void {
  if (typeof element.type !== "string")
    throw new Error("function components come later")
  const dom =
    element.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(element.type)

  const isProperty = (key: string): key is AttributeName =>
    isAttribute(key)
  Object.keys(element.props)
    .filter(isProperty)
    .forEach(name => {
      assignProperty(dom, name, element.props[name])
    })

  element.props.children.forEach(child =>
    render(child, dom)
  )

  container.appendChild(dom)
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
