/** @jsx React.createElement */
export {}

// Typed adaptation of Rodrigo Pombo’s Build your own React (2019).
type ReactElement = {
  type: string
  props: { [key: string]: unknown }
}

declare const React: {
  createElement(
    type: string,
    props?: object | null,
    ...children: unknown[]
  ): ReactElement
}

declare namespace React {
  namespace JSX {
    type Element = ReactElement
    interface IntrinsicElements
      extends globalThis.JSX.IntrinsicElements {}
  }
}

declare const ReactDOM: {
  render(
    element: ReactElement,
    container: HTMLElement | null
  ): void
}

// @lesson-start
const element = (
  <div id="foo">
    <a>bar</a>
    <b />
  </div>
)
const container = document.getElementById("root")
ReactDOM.render(element, container)
