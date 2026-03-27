# Advanced Features Reference

## Custom Functions as Components

```typst
#let note(body) = block(
  fill: luma(230), inset: 8pt, radius: 4pt, body,
)
#note[This is important.]
```

```typst
#let blockquote(body) = block(
  width: 100%,
  inset: (left: 1em, y: 0.5em),
  stroke: (left: 2pt + rgb("#d1d5db")),
  fill: rgb("#f9fafb"),
  body
)
```

## Templates

```typst
#let template(body) = {
  set page(margin: 2cm)
  set text(font: "New Computer Modern", size: 11pt)
  set heading(numbering: "1.")
  body
}
#show: template
```

The `#show: template` pattern passes all remaining content through the function. This is how document-wide configuration is applied.

For templates in separate files:

```typst
// template.typ
#let conf(title: none, body) = {
  set document(title: title)
  set page(margin: 2cm)
  set text(11pt)
  align(center, text(17pt, weight: "bold", title))
  body
}

// main.typ
#import "template.typ": conf
#show: conf.with(title: [My Paper])
```

Source: https://typst.app/docs/tutorial/making-a-template/

## Counters

```typst
// Access built-in counters
counter(heading)
counter(page)
counter(figure.where(kind: image))
counter(figure.where(kind: table))

// Custom counter
counter("my-counter")
```

### Methods

```typst
// Contextual (require `context`)
#context counter(heading).get()           // -> array of ints, e.g. (2, 1)
#context counter(heading).display()       // formatted with element's numbering
#context counter(heading).display("I")    // custom format
#context counter(heading).at(<label>)     // value at location
#context counter(heading).final()         // value at end of document

// Non-contextual (return content that must be placed)
#counter(heading).step()                  // increment by 1
#counter(heading).step(level: 2)          // step at depth 2
#counter(page).update(1)                  // set to value
#counter(page).update(n => n * 2)         // transform
```

**Display with total:**

```typst
#context counter(page).display("1 / 1", both: true)  // "3 / 10"
```

**Page counter with Roman/Arabic switch:**

```typst
#set page(numbering: "(i)")
= Preface
#set page(numbering: "1 / 1")
#counter(page).update(1)
= Main text
```

**Gotcha:** Counters start at zero — step before display. `step()` and `update()` return content that must be placed in the document. `let _ = counter(page).step()` does nothing.

Source: https://typst.app/docs/reference/introspection/counter/

## State

Arbitrary state management for values that evolve through the document:

```typst
#let total = state("total", 0)

#total.update(x => x + 1)
First: #context total.get()

#total.update(x => x + 1)
Second: #context total.get()
```

### Methods

```typst
#context state("key").get()          // current value
#context state("key").at(<label>)    // value at location
#context state("key").final()        // value at document end
state("key").update(value)           // set
state("key").update(old => new)      // transform
```

**Gotcha:** State is updated in layout order, not evaluation order. Updates return content that must be placed.

**Gotcha:** Avoid generating state updates from within `context` — can cause non-convergence. Prefer `update(f => not f)` over `context update(not get())`.

**Gotcha:** Multiple states with the same key but different `init` values share updates but use their own initial value.

Source: https://typst.app/docs/reference/introspection/state/

## Query

Search document elements:

```typst
#context {
  let chapters = query(heading.where(level: 1, outlined: true))
  for ch in chapters {
    let loc = ch.location()
    let nr = numbering(loc.page-numbering(), ..counter(page).at(loc))
    [#ch.body #h(1fr) #nr \ ]
  }
}
```

Accepts: element functions, `<label>`, `heading.where(level: 1)`, `selector(heading).before(here())`.

CLI query: `typst query example.typ "<note>" --field value --one`

**Gotcha:** Queries that affect themselves (e.g., generating headings based on heading count) may not converge.

Source: https://typst.app/docs/reference/introspection/query/

## The `context` Keyword

Required for all introspection functions:

- `counter.get()`, `.display()`, `.at()`, `.final()`
- `state.get()`, `.at()`, `.final()`
- `query()`
- `measure()`
- `here()`, `locate()`

Creates a contextual expression re-evaluated during layout:

```typst
#context {
  let loc = here()
  let heads = query(heading)
  let pg = counter(page).get()
  // use them
}
```

Source: https://typst.app/docs/reference/introspection/

## Numbering Patterns

```typst
#numbering("1.1)", 1, 2, 3)           // "1.2.3)"
#numbering("I – 1", 12, 2)            // "XII – 2"
#numbering("1.a", 1, 2)               // "1.b"
```

Counting symbols: `1`, `a`, `A`, `i`, `I`, `*` (dagger series), and many scripts (Chinese, Japanese, Korean, Arabic, Greek, Hebrew, etc.).

Custom numbering function:

```typst
#set heading(numbering: (..nums) => {
  nums.pos().map(str).join(".") + ")"
})
```

If more numbers than counting symbols, the last symbol repeats.

Source: https://typst.app/docs/reference/model/numbering/

## Metadata

Expose arbitrary values to the query system:

```typst
#metadata("This is a note") <note>

#context query(<note>).first().value
```

Useful for CLI queries and passing data between document parts.

Source: https://typst.app/docs/reference/introspection/metadata/

## Measure

Measure content size:

```typst
#context {
  let size = measure([Hello!])
  [Width: #size.width, Height: #size.height]
}

// Constrained width
#context measure(lorem(100), width: 400pt)
```

Returns dictionary with `width` and `height`. Measures in infinite space by default.

**Gotcha:** `measure(content, width: 400pt)` differs from `measure(block(content, width: 400pt))` — the former constrains layout space, the latter measures the block itself.

Source: https://typst.app/docs/reference/layout/measure/

## Packages (Typst Universe)

Import from the community package registry:

```typst
#import "@preview/package-name:version": items
```

The `@preview` namespace indicates community packages, not yet considered stable. Browse at https://typst.app/universe.

Popular packages include:

- `fletcher` — node & arrow diagrams (architecture, flowcharts, state machines)
- `cetz` — general-purpose vector drawings (similar to TikZ), with `cetz-plot` for charts
- `lilaq` — publication-quality scientific data visualization (line, scatter, bar, contour)
- `diagraph` — Graphviz DOT rendering with Typst-native labels
- `pintorita` — multi-diagram tool (sequence, ERD, component, activity, mind maps, Gantt)
- `timeliney` — Gantt charts and project timelines
- `gentle-clues` — admonition callout boxes (info, warning, tip, note, etc.)
- `charged-ieee` — IEEE conference template
- `modern-cv` — CV/resume templates

See `references/visualizations.md` for detailed usage examples and design principles.
