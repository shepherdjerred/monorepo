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

type TextElement = {
  type: "TEXT_ELEMENT"
  props: Props
}

type HostElement = {
  type: string
  props: Props
}

type DidactElement = TextElement | HostElement

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
  type: string,
  props?: { id?: string } | null,
  ...children: unknown[]
): {
  type: string
  props: { id?: string; children: unknown[] }
} {
  return {
    type,
    props: {
      ...props,
      children
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
