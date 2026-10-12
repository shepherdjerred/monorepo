/** @jsx React.createElement */
export {}

// Typed adaptation of Rodrigo Pombo’s Build your own React (2019).
type ReactNode = ReactElement | string | null

type ReactElement = {
  type:
    | string
    | ((props: { [key: string]: unknown }) => ReactNode)
  props: { [key: string]: unknown }
}

declare const React: {
  createElement(
    type: ReactElement["type"],
    props?: { [key: string]: unknown } | null,
    ...children: ReactNode[]
  ): ReactElement
}

declare const ReactDOM: {
  render(
    element: ReactElement,
    container: HTMLElement | null
  ): void
}

// @lesson-start
const element = React.createElement(
  "div",
  { id: "foo" },
  React.createElement("a", null, "bar"),
  React.createElement("b")
)
const container = document.getElementById("root")
ReactDOM.render(element, container)
