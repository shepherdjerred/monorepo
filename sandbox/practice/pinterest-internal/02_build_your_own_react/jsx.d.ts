export {}

declare global {
  namespace JSX {
    // JSX has the same structural element contract as our small renderer.
    interface Element {
      type: string | ((props: Element["props"]) => Element)
      props: {
        children: Element[]
        nodeValue?: string
        id?: string
        title?: string
        name?: string
      } & { [event in `on${string}`]?: EventListener }
    }
    interface IntrinsicElements {
      [tag: string]: {
        id?: string
        title?: string
        name?: string
        onClick?: (event: Event) => void
        children?: unknown
      }
    }
  }
}
