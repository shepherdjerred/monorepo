# Markup and Layout Reference

## Full Markup Syntax

| Element            | Syntax                  | Notes                                   |
| ------------------ | ----------------------- | --------------------------------------- |
| Paragraph break    | Blank line              | Two consecutive newlines                |
| Bold               | `*bold*`                | Equivalent to `strong()`                |
| Italic             | `_italic_`              | Equivalent to `emph()`                  |
| Inline code        | `` `code` ``            | Single backticks                        |
| Code block         | Triple backticks + lang | Triple backticks with optional language |
| Link               | `https://example.com`   | Auto-detected; or `#link("url")[text]`  |
| Label              | `<my-label>`            | Attaches to preceding element           |
| Reference          | `@my-label`             | References a labelled element           |
| Heading            | `= Heading`             | Number of `=` sets level                |
| Unordered list     | `- item`                | Dash at line start                      |
| Ordered list       | `+ item`                | Plus at line start; auto-numbered       |
| Term list          | `/ Term: Description`   | Slash, term, colon, description         |
| Line break         | `\`                     | Backslash forces line break             |
| Smart quotes       | `'` and `"`             | Auto-converted to typographic quotes    |
| Non-breaking space | `~`                     | Tilde shorthand                         |
| Em dash            | `---`                   | Three hyphens                           |
| En dash            | `--`                    | Two hyphens                             |
| Ellipsis           | `...`                   | Three dots                              |
| Escape             | `\#`, `\*`, etc.        | Backslash escapes special characters    |
| Unicode escape     | `\u{1f600}`             | Hex codepoint                           |
| Line comment       | `// comment`            | Ignored in output                       |
| Block comment      | `/* comment */`         | Can be nested                           |
| Code expression    | `#expr`                 | Switches to code mode                   |
| Inline math        | `$x^2$`                 | No spaces around content                |
| Block math         | `$ x^2 $`               | Spaces around content                   |

Source: https://typst.app/docs/reference/syntax/

## Headings

```typst
= Level 1
== Level 2
=== Level 3
```

Numbering via set rule:

```typst
#set heading(numbering: "1.")      // 1., 1.1., 1.1.1.
#set heading(numbering: "1.a")     // 1., 1.a, 1.a.a
#set heading(numbering: "(I)")     // Roman numerals
```

Source: https://typst.app/docs/tutorial/formatting/

## Lists

All support nesting via 2-space indentation:

```typst
- First item
- Second item
  - Nested item

+ Step one
+ Step two
  + Sub-step

/ Glacier: A persistent body of dense ice.
/ Moraine: Accumulated debris from a glacier.
```

## Labels and References

Labels attach to the preceding element. References auto-generate text ("Section 1", "Figure 2"):

```typst
= Introduction <intro>
See @intro for details.
```

Work on headings, figures, equations. Customize with `supplement`:

```typst
#set math.equation(supplement: [Eq.])
```

## Special Characters and Escaping

Characters with special meaning in markup mode: `\`, `*`, `_`, `#`, `[`, `]`, `<`, `>`, `@`, `$`, `=`, `-`, `+`, `~`, `'`, backtick, `"`. Some like `/` are only special in certain positions (e.g., term list start).

Comments work in all three modes. Block comments nest: `/* outer /* inner */ still outer */`.

Variable names use kebab-case convention and may contain hyphens but cannot start with one.

## Page Setup

```typst
#set page("a4")                              // named paper size
#set page("us-letter")                       // US Letter
#set page(width: 12cm, height: 12cm)         // custom
#set page("a4", flipped: true)               // landscape
#set page(height: auto)                      // dynamic height
```

Key parameters: `paper`, `width`, `height`, `flipped`, `margin`, `columns`, `fill`, `numbering`, `number-align`, `header`, `footer`, `binding`.

Source: https://typst.app/docs/reference/layout/page/

## Margins

```typst
#set page(margin: 2cm)                                   // all sides
#set page(margin: (x: 1.8cm, y: 1.5cm))                 // horizontal/vertical
#set page(margin: (top: 3cm, right: 2cm, bottom: 2cm, left: 2.5cm))
#set page(margin: (inside: 2.5cm, outside: 2cm, y: 1.75cm))  // book binding
#set page(margin: (left: 1.5in, rest: 1in))              // rest sets unspecified
```

`inside`/`outside` and `left`/`right` are mutually exclusive.

Source: https://typst.app/docs/guides/page-setup-guide/

## Headers and Footers

```typst
#set page(header: [
  #set text(8pt)
  #smallcaps[My Document]
  #h(1fr) _Chapter 1_
])
```

Skip first page:

```typst
#set page(header: context {
  if counter(page).get().first() > 1 [
    _My Thesis_ #h(1fr) University Name
  ]
})
```

**Gotcha:** Custom `footer` silently overrides `numbering`. Display page numbers manually:

```typst
#set page(footer: context [
  *My Org* #h(1fr) #counter(page).display("1/1", both: true)
])
```

## Page Numbering

```typst
#set page(numbering: "1")           // Arabic
#set page(numbering: "i")           // Roman
#set page(numbering: "— 1 —")      // Decorated
#set page(numbering: "1 of 1")     // "3 of 10" (second 1 = total)
```

Reset: `#counter(page).update(1)`. Physical page: `#context here().page()`.

Alignment: `#set page(numbering: "1", number-align: right + top)`.

## Columns

```typst
#set page(columns: 2)              // page-level (preferred)
#colbreak()                        // manual column break
```

Single-column title spanning two-column body:

```typst
#set page(columns: 2)
#place(top + center, float: true, scope: "parent", clearance: 2em)[
  // Title content here
]
```

Always prefer `#set page(columns: N)` over `columns()` for page-level columns — handles floats, footnotes, and line numbers correctly.

## Spacing and Alignment

```typst
Left #h(1fr) Right                 // fractional horizontal space
#v(1em)                            // vertical space
#align(center)[Centered]
#align(right + horizon)[Right, vertically centered]
#pad(left: 20pt)[Padded content]
```

Horizontal: `left`, `center`, `right`, `start`, `end`. Vertical: `top`, `horizon`, `bottom`. Combine with `+`.

## Block vs Box

**`block`** — block-level (causes paragraph breaks):

```typst
#block(fill: luma(230), inset: 8pt, radius: 4pt)[Content]
#block(above: 2em, below: 1em)[Spaced block]
```

**`box`** — inline (stays within a line):

```typst
#box(image("icon.svg", height: 1em))
#box(fill: aqua, inset: 2pt)[tag]
```

## Page Breaks

```typst
#pagebreak()                       // page break
#pagebreak(weak: true)             // only if not at page start

#page(flipped: true)[              // one-off landscape page
  // content
]
```

## Set Rules

Configure defaults. Scoped to current block:

```typst
#set text(font: "New Computer Modern", size: 12pt)
#set par(justify: true, leading: 0.52em)
```

Conditional: `#set text(red) if critical`.

Common targets: `text`, `page`, `par`, `heading`, `document`.

Source: https://typst.app/docs/reference/styling/#set-rules

## Show Rules

**Show-set** (composable, overridable):

```typst
#show heading: set text(navy)
#show heading.where(level: 1): set align(center)
```

**Transformational** (replaces rendering):

```typst
#show heading: it => block[~ #emph(it.body) ~]
```

**Everything rule:**

```typst
#show: columns.with(2)
#show: rest => { set page(margin: 2cm); rest }
```

**Text replacement:**

```typst
#show "badly": "great"
#show "Project": smallcaps
```

Selectors: element function, `.where(field: val)`, `"text"`, `regex(...)`, `<label>`, bare `show:`.

**Gotcha:** Transformational rules bypass defaults — lose numbering, spacing, block behavior. Prefer show-set for composable styling.

Source: https://typst.app/docs/reference/styling/#show-rules
