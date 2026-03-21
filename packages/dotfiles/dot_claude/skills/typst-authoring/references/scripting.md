# Scripting Reference

## Entering Code Mode

Prefix any expression with `#` in markup mode. Stay in code mode until the expression ends. Use `;` to explicitly return to markup. Binary operators need parentheses: `#(1 + 2)`.

Source: https://typst.app/docs/reference/scripting/

## Blocks

**Code blocks** `{ ... }` — multiple expressions, output values joined:

```typst
#{
  let x = 1
  [The answer is #(x + 2).]
}
```

**Content blocks** `[ ... ]` — markup, produce `content` value:

```typst
#let greeting = [Hello *world*]
```

Nest arbitrarily. Content blocks can be trailing arguments to functions.

## Types

| Type | Literal | Notes |
|------|---------|-------|
| `none` | `none` | |
| `auto` | `auto` | |
| `bool` | `true`, `false` | |
| `int` | `10`, `0xff`, `0b1010`, `0o17` | |
| `float` | `3.14`, `1e5` | |
| `str` | `"hello"` | |
| `content` | `[*Hello*]` | Content block |
| `array` | `(1, 2, 3)` | Single-element: `(1,)` |
| `dictionary` | `(a: "hi", b: 2)` | Empty: `(:)` |
| `length` | `2pt`, `3mm`, `1em`, `1in` | |
| `angle` | `90deg`, `1rad` | |
| `ratio` | `50%` | |
| `fraction` | `2fr` | Distributes remaining space |
| `label` | `<intro>` | |
| `function` | `(x, y) => x + y` | Lambda |

**Gotcha:** `(1)` is a parenthesized expression, not an array. Use `(1,)` for single-element array. Empty array: `()`. Empty dictionary: `(:)`.

Type checking: `type(x) == int`.

Source: https://typst.app/docs/reference/foundations/type/

## Let Bindings and Destructuring

```typst
#let name = "Typst"
#let (x, y) = (1, 2)                  // array destructuring
#let (a, .., b) = (1, 2, 3, 4)        // a=1, b=4, rest discarded
#let (Homer: h) = books               // dict destructuring with rename
#let (_, y, _) = (1, 2, 3)            // discard with _
```

Swap: `(a, b) = (b, a)`.

In function args: `left.zip(right).map(((a, b)) => a + b)` (note double parens).

## Control Flow

**Conditionals** yield values:

```typst
#if 1 < 2 [This is shown] else [This is not]
```

**For loops** — arrays, dicts, strings:

```typst
#for value in array [#value ]
#for (key, value) in dict [#key: #value \ ]
#for letter in "abc" [#letter ]
```

**While loops:**

```typst
#{
  let n = 2
  while n < 10 { n = (n * 2) - 1 }
}
```

`break` and `continue` work. Bodies can be `{..}` or `[..]`.

## Functions

**Named:**

```typst
#let alert(body, fill: red) = {
  set text(white)
  set align(center)
  rect(fill: fill, inset: 8pt, radius: 4pt, [*Warning:\ #body*])
}
#alert[Danger!]
#alert(fill: blue)[KEEP OFF]
```

**Anonymous (closures):**

```typst
#let double = x => x * 2
#let add = (x, y) => x + y
#range(10).map(x => x * x)
```

All functions are pure. `return` for early exit.

**Partial application:** `#let red-alert = alert.with(fill: red)`

**Selectors:** `#show heading.where(level: 2): set text(blue)`

Source: https://typst.app/docs/reference/foundations/function/

## Argument Sinks and Spreading

```typst
#let format(title, ..authors) = {
  let by = authors.pos().join(", ", last: " and ")
  [*#title* \ _Written by #by;_]
}
```

Sink methods: `.pos()` (array), `.named()` (dictionary), `.at(key)`.

Spread into calls: `#calc.min(..array)`, `#text(..dict)[Hello]`.

Construct: `#let args = arguments(stroke: red, inset: 1em, [Body])`.

Source: https://typst.app/docs/reference/foundations/arguments/

## Methods

Dot notation. Two equivalent forms:

```typst
#str.len("abc")   // full form
#"abc".len()      // method form
```

Mutating methods (e.g., `array.push()`) must use method form. Discard unused returns: `let _ = array.remove(1)`.

### Key Array Methods

`.len()`, `.at(i)`, `.first()`, `.last()`, `.push(v)`, `.pop()`, `.insert(i, v)`, `.remove(i)`, `.slice(start, end)`, `.contains(v)`, `.find(fn)`, `.position(fn)`, `.filter(fn)`, `.map(fn)`, `.enumerate()`, `.zip(..others)`, `.fold(init, fn)`, `.reduce(fn)`, `.sum()`, `.product()`, `.any(fn)`, `.all(fn)`, `.flatten()`, `.rev()`, `.sorted()`, `.dedup()`, `.join(sep)`, `.chunks(n)`, `.windows(n)`, `.split(v)`, `.to-dict()`.

### Key Dictionary Methods

`.len()`, `.at(key, default: v)`, `.insert(key, v)`, `.remove(key)`, `.keys()`, `.values()`, `.pairs()`.

Field access syntax: `dict.greet` instead of `dict.at("greet")`.

## Operators

| Precedence | Operators |
|-----------|-----------|
| 7 | `-x`, `+x` (unary) |
| 6 | `*`, `/` |
| 5 | `+`, `-` |
| 4 | `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `not` |
| 3 | `and` |
| 2 | `or` |
| 1 | `=`, `+=`, `-=`, `*=`, `/=` |

No modulus operator — use `calc.rem()` (remainder, can be negative) or `calc.mod()` (true modulus, always non-negative).

Source: https://typst.app/docs/reference/scripting/

## Imports and Modules

```typst
#include "chapter.typ"                    // insert content
#import "utils.typ": my-func              // specific items
#import "utils.typ": *                    // all items
#import "utils.typ" as utils              // module namespace
#import "utils.typ": a as one, b as two   // rename
#import "@preview/tablex:0.0.8": tablex   // package import
```

`@namespace/name:version` for packages. `@preview` = community packages on Typst Universe.

Source: https://typst.app/docs/reference/scripting/
