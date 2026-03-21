# Math Typesetting Reference

## Math Mode Basics

- **Inline:** `$x^2$` (no spaces after/before `$`)
- **Block (display):** `$ x^2 $` (spaces after opening and before closing `$`)

Block equations are centered. Enable page breaking: `#show math.equation: set block(breakable: true)`.

Single letters = italic variables. Multiple consecutive letters = function/variable names (upright). Use `"text"` for multi-letter text. Access code variables with `#`: `$ #x < 17 $`.

Source: https://typst.app/docs/reference/math/

## Symbols and Greek Letters

Greek: `alpha`, `beta`, `gamma`, `delta`, `epsilon`, `zeta`, `eta`, `theta`, `iota`, `kappa`, `lambda`, `mu`, `nu`, `xi`, `pi`, `rho`, `sigma`, `tau`, `upsilon`, `phi`, `phi.alt`, `chi`, `psi`, `omega`.

Uppercase: `Alpha`, `Beta`, `Gamma`, `Delta`, `Theta`, `Lambda`, `Pi`, `Sigma`, `Phi`, `Psi`, `Omega`, `Xi`.

Blackboard bold shortcuts: `NN` (naturals), `ZZ` (integers), `QQ` (rationals), `RR` (reals), `CC` (complex). Or `bb(N)`.

Symbol variants: `arrow.r`, `arrow.l`, `arrow.l.r`.

Shorthand sequences: `=>` (implies), `->` (right arrow), `<-` (left arrow), `!=` (not equal), `<=`, `>=`, `...` (ellipsis), `~` (non-breaking space).

## Subscripts and Superscripts

Use `_` for subscripts and `^` for superscripts. Parentheses for multi-character:

```typst
$ x_1, x^2, x_1^2 $
$ sum_(i=0)^n a_i = 2^(1+i) $
```

`attach()` for all six positions:

```typst
$ attach(Pi, t: alpha, b: beta, tl: 1, tr: 2, bl: 3, br: 4) $
```

Positions: `t` (top), `b` (bottom), `tl`, `tr`, `bl`, `br`.

**Limits vs scripts:**

- `limits(sum)_1^2` — forces above/below placement
- `scripts(sum)_1^2` — forces side placement

Typst auto-decides based on the base character.

Source: https://typst.app/docs/reference/math/attach/

## Fractions

```typst
$ 1/2 < (x+1)/2 $                 // slash syntax
$ frac(a, b) $                     // function syntax
```

**Gotcha:** Grouping parentheses in `(a+b)/c` are consumed by fraction syntax. Double them `((a+b))/c` to keep visible.

Fraction styles (settable): `"vertical"` (default, stacked), `"skewed"` (slash), `"horizontal"` (inline).

```typst
#set math.frac(style: "skewed")
#show math.equation.where(block: false): set math.frac(style: "horizontal")
```

Source: https://typst.app/docs/reference/math/frac/

## Roots

```typst
$ sqrt(x) $            // square root
$ root(3, x) $         // cube root
$ root(n, x) $         // nth root
```

Source: https://typst.app/docs/reference/math/roots/

## Matrices

Rows separated by semicolons, columns by commas:

```typst
$ mat(1, 2; 3, 4) $
$ mat(delim: "[", 1, 0; 0, 1) $
$ mat(1, 0, 1; 0, 1, 2; augment: #2) $    // augmented matrix
```

Parameters: `delim` (default `("(", ")")`), `align`, `gap`, `row-gap`, `column-gap`, `augment`.

Spread data: `$ mat(..#data) $` where data is array of arrays.

Source: https://typst.app/docs/reference/math/mat/

## Vectors

```typst
$ vec(a, b, c) dot vec(1, 2, 3) = a + 2b + 3c $
```

Parameters: `delim` (default parens), `align`, `gap`.

Source: https://typst.app/docs/reference/math/vec/

## Alignment

Use `&` for alignment points and `\` for line breaks:

```typst
$ sum_(k=0)^n k
    &= 1 + ... + n \
    &= (n(n+1)) / 2 $
```

Multiple `&` alternate right-aligned and left-aligned columns:

```typst
$ (3x + y) / 7 &= 9 && "given" \
  3x + y &= 63 & "multiply by 7" \
  x &= 21 - y/3 & "divide by 3" $
```

Source: https://typst.app/docs/reference/math/

## Equation Numbering

```typst
#set math.equation(numbering: "(1)")

$ phi.alt := (1 + sqrt(5)) / 2 $ <ratio>

With @ratio, we get:
$ F_n = floor(1 / sqrt(5) phi.alt^n) $
```

Parameters: `numbering`, `number-align` (default `end + horizon`), `supplement` (default `auto`, set to e.g. `[Eq.]`).

Per-equation alignment: `#set math.equation(numbering: "(1)", number-align: bottom)`.

Source: https://typst.app/docs/reference/math/equation/

## Delimiters

Matched delimiters auto-scale. Manual control:

```typst
$ lr(]sum_(x=1)^n], size: #50%) $
$ abs(x), norm(x), floor(x), ceil(x), round(x) $
```

Escape to prevent auto-scaling: `$ \{ x / y \} $`.

Disable all: `#set math.lr(size: 1em)`.

`mid()` scales a delimiter to nearest `lr()` group:

```typst
$ { x mid(|) sum_(i=1)^n w_i|f_i (x)| < 1 } $
```

Source: https://typst.app/docs/reference/math/lr/

## Cases

```typst
$ f(x) := cases(
  1 "if" x > 0,
  0 "if" x <= 0,
) $
```

Parameters: `delim` (default `("{", "}")`), `reverse`, `gap`. Use `&` to align across branches.

Source: https://typst.app/docs/reference/math/cases/

## Binomial Coefficients

```typst
$ binom(n, k) $
$ binom(n, k_1, k_2, k_3) $   // multinomial
```

Source: https://typst.app/docs/reference/math/binom/

## Accents and Decorations

```typst
$ hat(x), dot(x), tilde(x), arrow(x), macron(x), grave(x), acute(x) $
```

Under/over decorations:

```typst
$ underbrace(1 + 2 + ... + n, n "terms") $
$ overbrace(1 + 2 + ... + n, n "terms") $
$ underbracket(...), overbracket(...) $
$ underparen(...), overparen(...) $
$ underline(...), overline(...) $
```

All accept an optional annotation argument.

Source: https://typst.app/docs/reference/math/accent/

## Font Styles in Math

**Letterform styles:**

- `upright(A)` — non-italic
- `italic(A)` — italic
- `bold(A)` — bold

**Variant typefaces:**

- `serif(A)` — serif (default)
- `sans(A)` — sans-serif
- `frak(P)` — fraktur
- `mono(x + y = z)` — monospace
- `bb(N)` — blackboard bold
- `cal(A)` — calligraphic
- `scr(L)` — script

Change math font: `#show math.equation: set text(font: "Fira Math")` (requires OpenType math font).

Source: https://typst.app/docs/reference/math/variants/

## Custom Operators

Predefined: `sin`, `cos`, `tan`, `log`, `ln`, `exp`, `lim`, `sup`, `inf`, `max`, `min`, `det`, `gcd`, `lcm`, `mod`, `dim`, `ker`, `hom`, `deg`, `Pr`, `arg`, and more.

Custom:

```typst
$ op("argmax", limits: #true)_(x in RR) f(x) $
```

`limits: true` makes attachments display above/below in display mode.

Source: https://typst.app/docs/reference/math/op/

## Math Function Calls

Math mode supports function calls without `#`. Inside them, still in math mode:

```typst
$ frac(a^2, 2) $
$ vec(1, 2, delim: "[") $
$ mat(1, 2; 3, 4) $                     // semicolons create rows
```

**Gotcha:** Math calls don't support trailing content blocks. Semicolons merge args into arrays (2D syntax). Use `#` for code expressions inside math calls.

## Accessibility

```typst
#math.equation(
  alt: "d S equals delta q divided by T",
  block: true,
  $ dif S = (delta q) / T $,
)
```

Source: https://typst.app/docs/reference/math/equation/
