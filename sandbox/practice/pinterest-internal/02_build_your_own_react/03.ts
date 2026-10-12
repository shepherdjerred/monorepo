/** @jsx Didact.createElement */
export {}

// Typed adaptation of Rodrigo Pombo’s Build your own React (2019).
type EventName = `on${string}`

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

declare const React: {
  createElement(
    type: string,
    props?: { id?: string } | null,
    ...children: unknown[]
  ): HostElement
}

declare const ReactDOM: {
  render(
    element: DidactElement | HostElement,
    container: HTMLElement | null
  ): void
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

const element = React.createElement(
  "div",
  { id: "foo" },
  React.createElement("a", null, "bar"),
  React.createElement("b")
)
const container = document.getElementById("root")
ReactDOM.render(element, container)
