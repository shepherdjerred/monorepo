---
name: typst-authoring
description: This skill should be used when the user asks to "write Typst", "create a Typst document", "format in Typst", "convert to Typst", "Typst syntax", "Typst template", "Typst math", "Typst table", or works with .typ files. Provides comprehensive Typst markup, scripting, math, layout, and styling reference for authoring documents. Also use proactively when generating .typ output files (e.g., in deep-research reports).
---

# Typst Authoring Reference

Typst is a modern typesetting language with three syntactic modes: **markup** (default), **code** (`#`), and **math** (`$`). Understanding mode transitions is the core skill for productive authoring.

## Three Modes at a Glance

- **Markup mode** (default) — Text, `*bold*`, `_italic_`, `= Heading`, `- list`, `+ ordered`, `/ term: def`
- **Code mode** (enter with `#`) — Variables, functions, control flow, imports. End with `;` to return to markup.
- **Math mode** (enter with `$`) — `$inline$` (no spaces) or `$ block $` (spaces). Single letters = italic variables; multi-letter = function names.

## Essential Syntax Quick Reference

| Element | Syntax |
|---------|--------|
| Bold / Italic | `*bold*` / `_italic_` |
| Heading | `= H1`, `== H2`, `=== H3` |
| Lists | `- bullet`, `+ numbered`, `/ Term: def` |
| Link | `https://...` or `#link("url")[text]` |
| Label / Reference | `<name>` / `@name` |
| Code expression | `#expr` |
| Line break | `\` |
| Comment | `// line` or `/* block */` |
| Non-breaking space | `~` |
| Dashes | `--` (en), `---` (em) |
| Escape | `\#`, `\@`, `\$`, `\*`, etc. |

## Set Rules and Show Rules

**Set rules** configure defaults for functions:

```typst
#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true)
#set heading(numbering: "1.")
#set page("a4", margin: (x: 2.5cm, y: 2.5cm))
```

Set rules are scoped to their enclosing content block `[...]`.

**Show rules** transform rendering:

```typst
#show heading: set text(navy)              // show-set (composable)
#show heading: it => emph(it.body)         // transformational
#show: columns.with(2)                     // everything rule
#show heading.where(level: 1): set align(center)  // filtered
```

Selectors: element functions, `.where(field: val)`, `"text"`, `regex(...)`, `<label>`, or bare `show:` for everything.

Prefer show-set rules over transformational rules for composability.

## Page Layout Essentials

```typst
#set page("a4", margin: (x: 2.5cm, y: 2.5cm), numbering: "1")
#set page(header: [Title #h(1fr) Author], footer: context [
  #h(1fr) #counter(page).display("1/1", both: true)
])
#set page(columns: 2)          // page-level columns (preferred)
#colbreak()                    // manual column break
#pagebreak(weak: true)         // page break
```

When a custom `footer` is set, the `numbering` parameter is silently ignored — display page numbers manually via `counter(page).display()`.

## Code Mode Essentials

Enter with `#`. Key types: `none`, `auto`, `bool`, `int`, `float`, `str`, `content`, `array`, `dictionary`, `length`, `ratio`, `fraction`, `function`.

Single-element array: `(1,)` (trailing comma required). Empty dict: `(:)`.

```typst
#let x = 42
#if x > 10 [big] else [small]
#for item in items [#item, ]
#let greet(name, excited: false) = [Hello #name#if excited [!]]
```

Functions are pure. Use `.with()` for partial application. Import with `#import "file.typ": item` or `#import "@preview/pkg:version": item`.

## Math Mode Essentials

```typst
$a^2 + b^2 = c^2$                    // inline
$ sum_(i=0)^n a_i = integral f(x) dif x $  // block

$ frac(a, b), sqrt(x), root(3, x) $  // fractions, roots
$ mat(1, 2; 3, 4) $                   // matrix (semicolons = rows)
$ vec(a, b, c) $                      // vector
$ cases(1 "if" x > 0, 0 "else") $    // cases
```

Greek: `alpha`, `beta`, `gamma`, `pi`, etc. Blackboard bold: `NN`, `ZZ`, `RR`, `CC`. Accents: `hat(x)`, `dot(x)`, `tilde(x)`, `arrow(x)`. Styles: `bold(A)`, `cal(A)`, `bb(N)`, `frak(P)`.

Equation numbering: `#set math.equation(numbering: "(1)")`. Reference with `$ ... $ <label>` and `@label`.

## Tables Quick Reference

```typst
#table(
  columns: (1fr, auto, auto),
  table.header([*Name*], [*Age*], [*City*]),
  [Alice], [30], [NYC],
  [Bob], [25], [LA],
)
```

Key features: `table.cell(colspan: 2)`, `table.cell(rowspan: 3)`, `table.hline()`, `table.vline()`. Alignment/fill/stroke accept arrays (cycle per column) or `(x, y) =>` functions. Use `table` for data (accessible), `grid` for layout.

## Figures and Bibliography

```typst
#figure(image("photo.jpg", width: 80%), caption: [A photo.]) <fig>
@fig shows the photo.

#bibliography("refs.bib", style: "ieee")
@key, @key[p.~7], #cite(<key>, form: "prose")
#footnote[Note text]
```

## Key Gotchas

1. **Fraction parens consumed:** `(a+b)/c` removes the parens. Double them: `((a+b))/c`.
2. **`context` required for introspection:** `counter.get()`, `state.get()`, `query()`, `measure()`, `here()`.
3. **Counter starts at zero:** Step before display. `step()`/`update()` return content that must be placed.
4. **Custom footer kills numbering:** Set `footer:` means `numbering:` is ignored.
5. **Show rules bypass defaults:** Transformational show rules lose numbering, spacing, block behavior.
6. **Math multi-letter:** `area` in math = function name. Use `"area"` for text.
7. **`#` in math:** Access code variables with `#`: `$ #x < 17 $`.

## Additional Resources

### Reference Files

For detailed syntax, patterns, and examples, consult:

- **`references/markup-and-layout.md`** — Full markup syntax table, headings, lists, labels, references, escaping, page setup, margins, headers/footers, columns, spacing, alignment, block/box
- **`references/scripting.md`** — Code mode, types, let bindings, destructuring, control flow, functions, closures, argument sinks, operators, methods, imports, modules
- **`references/math.md`** — Math mode, symbols, Greek letters, subscripts/superscripts, fractions, roots, matrices, vectors, alignment, equation numbering, delimiters, cases, accents, font styles, custom operators
- **`references/tables-figures-bibliography.md`** — Tables (columns, headers, cell spans, alignment, fill, stroke, grid vs table), figures, images, captions, floating figures, bibliography, citations, footnotes
- **`references/advanced.md`** — Custom functions, templates, counters, state, query, context keyword, numbering patterns, metadata, measure, packages

### Typst Document Template

Standard document setup for reports and research output:

```typst
#set page(margin: (x: 2.5cm, y: 2.5cm), numbering: "1")
#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")
#show link: it => text(fill: rgb("#2563eb"), it)
```

### Special Character Escaping in Typst Content

Characters requiring `\` escape in content text: `#`, `@`, `$`, `<`, `>`. When converting Markdown to Typst, escape these in body text but not inside code blocks.

### Markdown-to-Typst Conversion

| Markdown | Typst |
|----------|-------|
| `# Heading` | `= Heading` |
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `1. item` | `+ item` |
| `[text](url)` | `#link("url")[text]` |
| `> quote` | `#blockquote[text]` (custom helper) |
| `[1]` refs | `#super[1]` |
