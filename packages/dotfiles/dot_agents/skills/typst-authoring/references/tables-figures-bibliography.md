# Tables, Figures, and Bibliography Reference

## Tables

### Basic Syntax

Cells in row-major order; auto-wraps into rows:

```typst
#table(
  columns: (1fr, auto, auto),
  inset: 10pt,
  align: horizon,
  table.header([*Name*], [*Age*], [*City*]),
  [Alice], [30], [NYC],
  [Bob], [25], [LA],
)
```

Source: https://typst.app/docs/reference/model/table/

### Column Sizing

```typst
columns: 3                          // integer shorthand
columns: (auto, auto, 1fr)          // explicit widths
columns: (6cm, 40%, 1fr)            // mixed units
columns: (1fr,) + 5 * (auto,)       // repeating pattern
```

- `auto` — grows to fit content
- Lengths: `6cm`, `0.7in`, `120pt`, `2em`
- Ratios: `40%`
- Fractional: `1fr`, `2fr` — distributes remaining space

### Headers and Footers

```typst
table.header([*Col 1*], [*Col 2*])  // repeats across pages
table.footer([*Total*], [42])       // repeats at page bottoms
```

Parameters: `repeat: bool` (default `true`), `level: int` (multi-level headers, added in 0.13.0+).

Always use `table.header` for accessibility even on single-page tables.

### Cell Spans

```typst
table.cell(colspan: 2)[Spans two columns]
table.cell(rowspan: 3, align: horizon)[Spans three rows]
table.cell(x: 1, y: 2)[Manual position]       // zero-indexed
```

Full `table.cell` parameters: `body`, `x`, `y`, `colspan`, `rowspan`, `inset`, `align`, `fill`, `stroke`, `breakable`.

### Alignment

```typst
// Single value
align: center + horizon

// Per-column array
align: (right, left, left)

// Function
align: (x, y) => if x == 0 { right } else { left }
```

### Fill (Striped Tables)

```typst
// Column stripes (array cycles per column)
fill: (rgb("EAF2F5"), none)

// Row stripes (function)
fill: (_, y) => if calc.odd(y) { rgb("EAF2F5") }

// Per-cell override
table.cell(fill: green.lighten(60%))[A]
```

**Gotcha:** Array `fill` cycles per column, not row. Use a function for row-based stripes.

### Stroke Customization

```typst
stroke: none                        // no borders
stroke: 0.5pt + gray                // uniform
stroke: (x: none)                   // horizontal lines only
stroke: (y: none)                   // vertical lines only

// Only line below header
stroke: (_, y) => if y == 0 { (bottom: 1pt) }

// Inner lines only
stroke: (x, y) => (
  left: if x > 0 { 0.8pt },
  top: if y > 0 { 0.8pt },
)
```

Dictionary keys: `top`, `left`, `right`, `bottom`, `x` (vertical), `y` (horizontal), `rest`.

### Explicit Lines

```typst
table.hline()                       // horizontal line
table.vline(x: 1, start: 1)        // partial vertical line
```

Parameters: position (`y`/`x`), `start`, `end`, `stroke`, `position` (top/bottom or start/end).

### Show Rules on Cells

```typst
#show table.cell.where(y: 0): strong            // bold header
#show table.cell.where(x: 0): set text(style: "italic")
```

### Grid vs Table

Both share the same layout engine. Differences:

- `table` defaults: `stroke: 1pt + black`, `inset: 0% + 5pt`
- `grid` defaults: `stroke: none`, `inset: 0pt`
- Set/show rules on one don't affect the other
- Use `table` for semantic data (screen readers); `grid` for layout

### Table Tips

- Break across pages: tables break automatically. For figures: `#show figure: set block(breakable: true)`
- Rotate: `#rotate(-90deg, reflow: true, table(...))` or `#page(flipped: true)[#table(...)]`
- Gutter adds space not included in column width percentages

Source: https://typst.app/docs/guides/table-guide/

## Figures

### Basic Figure

```typst
#figure(
  image("photo.jpg", width: 80%),
  caption: [A photograph of a glacier.],
) <glacier>

@glacier shows the glacier.
```

Auto-detects kind (image, table, code) with separate counters.

Parameters: `body`, `alt`, `placement`, `scope`, `caption`, `kind`, `supplement`, `numbering` (default `"1"`), `gap`, `outlined`.

Source: https://typst.app/docs/reference/model/figure/

### Floating Figures

```typst
#figure(
  placement: top,                    // or bottom, auto
  scope: "parent",                   // spans columns in multi-column
  caption: [Full-width figure],
  image("wide.jpg"),
)

#show figure: set place(clearance: 1em)
```

### Caption Customization

```typst
#show figure.where(kind: table): set figure.caption(position: top)
#set figure.caption(separator: [ --- ])

// Fully custom
#show figure.caption: it => [
  #underline(it.body) |
  #it.supplement #context it.counter.display(it.numbering)
]
```

### Custom Figure Kinds

```typst
#figure(
  circle(radius: 10pt),
  caption: [A curious atom.],
  kind: "atom",
  supplement: [Atom],
)
```

## Images

```typst
#image("photo.jpg", width: 80%)
#image("diagram.svg")
```

Supported formats: PNG, JPG, GIF, WebP, SVG, PDF.

Parameters: `source` (path or bytes), `format`, `width`, `height`, `alt`, `page` (PDF), `fit`, `scaling`, `icc`.

Fit modes: `"cover"` (default when both dimensions set — fills, may crop), `"contain"` (fits within, preserves ratio), `"stretch"` (fills exactly, may distort). When only one dimension is specified, scales proportionally.

```typst
// SVG manipulation
#let original = read("diagram.svg")
#let changed = original.replace("#2B80FF", green.to-hex())
#image(bytes(changed))
```

Source: https://typst.app/docs/reference/visualize/image/

## Bibliography

```typst
#bibliography("works.bib")                   // BibTeX
#bibliography("works.yml")                   // Hayagriva (Typst native)
#bibliography(("a.bib", "b.yml"))            // multiple sources
#bibliography("works.bib", style: "apa")     // citation style
#bibliography("works.bib", full: true)       // include uncited entries
#bibliography("works.bib", title: none)      // no title
#show bibliography: set heading(numbering: "1.")
```

70+ built-in styles: `"ieee"`, `"apa"`, `"chicago-author-date"`, `"chicago-notes"`, `"mla"`, `"nature"`, `"vancouver"`, `"harvard-cite-them-right"`, `"alphanumeric"`, and more. Custom CSL files supported.

Source: https://typst.app/docs/reference/model/bibliography/

## Citations

```typst
@arrgh                              // reference syntax (most common)
#cite(<arrgh>)                      // explicit cite
#cite(label("DBLP:key"))            // for keys with special chars
@distress[p.~7]                     // with supplement (page number)
#cite(<key>, form: "prose")         // "Author (Year)"
#cite(<key>, form: "full")          // full bibliography entry
#cite(<key>, form: "author")        // author only
#cite(<key>, form: "year")          // year only
#cite(<key>, form: none)            // add to bib without displaying
@arrgh @netwok.                     // multiple citations
```

Source: https://typst.app/docs/reference/model/cite/

## Footnotes

```typst
Check the docs.#footnote[Available at typst.app/docs]

#set footnote(numbering: "*")       // custom numbering

// Reusable with label
#footnote[The app] <fn>
See @fn again.
#footnote(<fn>)                     // reference existing footnote
```

Styling:

```typst
#show footnote.entry: set text(red)
#set footnote.entry(separator: repeat[.], clearance: 3em, gap: 0.8em, indent: 0em)
```

**Gotcha:** Footnote entry properties must be uniform per page run — define at document start.

Source: https://typst.app/docs/reference/model/footnote/
