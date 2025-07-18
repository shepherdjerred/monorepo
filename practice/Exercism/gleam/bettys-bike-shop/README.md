# Betty's Bike Shop

Welcome to Betty's Bike Shop on Exercism's Gleam Track.
If you need help running the tests or submitting your code, check out `HELP.md`.
If you get stuck on the exercise, check out `HINTS.md`, but try and solve it without using those first :)

## Introduction

## Ints

There are two different kinds of numbers in Gleam - ints and floats.

Ints are whole numbers.

```gleam
let integer = 3
// -> 3
```

Gleam has several operators that work with ints.

```gleam
1 + 1 // -> 2
5 - 1 // -> 4
5 / 2 // -> 2
3 * 3 // -> 9
5 % 2 // -> 1

2 > 1  // -> True
2 < 1  // -> False
2 >= 1 // -> True
2 <= 1 // -> False
```

## Floats

Floats are numbers with one or more digits behind the decimal separator.

```gleam
let float = 3.45
// -> 3.45
```

Floats also have their own set of operators.

```gleam
1.0 +. 1.4 // -> 2.4
5.0 -. 1.5 // -> 3.5
5.0 /. 2.0 // -> 2.5
3.0 *. 3.1 // -> 9.3

2.0 >. 1.0  // -> True
2.0 <. 1.0  // -> False
2.0 >=. 1.0 // -> True
2.0 <=. 1.0 // -> False
```

## Modules

### Modules

Gleam code is organised into modules, and each file is one Gleam module.

Up until now we have written functions with the `pub fn` syntax, which defines a function that is publicly available to other modules. Functions defined with `fn` are private to the module they are defined in and cannot be used by other modules.

```gleam
// This function is public
pub fn add(x, y) {
  x + y
}

// This function is private
fn subtract(x, y) {
  x - y
}
```

Gleam modules have names, and the name is based on their file path within the `src` or `test` directory.

For example, a module defined in `src\geometry\rectangle.gleam` (on Windows) or `src/geometry/rectangle.gleam` (on UNIX-like operating systems) would be named `geometry/rectangle`.

### Importing functions from other modules

Accessing functions defined in other modules is done via imports.
All functions within that module that were exposed by it are made accessible when importing that module.
But how they are accessed varies depending on how the module is imported.

Qualified imports are the default, and accessing a function within such module (for example the `map` function in the `gleam/list` module) is done by prefixing the module name (`list.map`).

```gleam
// Import the int module
import gleam/int

pub fn run(x: Int) -> String {
  // Use the to_string function from the int module
  int.to_string(x)
}
```

By default the name used to refer to the module is the last part of the module name, in this case `int`, but this can be changed by using the `as` keyword.

```gleam
// Import the int module and refer to it as i
import gleam/int as i

pub fn run(x: Int) -> String {
  i.to_string(x)
}
```

Unqualified imports enable direct access to the exposed functions within that module, without prefixing.

```gleam
// Import the to_string function from the int module
import gleam/int.{to_string}

pub fn run(x: Int) -> String {
  to_string(x)
}
```

Qualified imports are preferred as they make it clearer to the reader where a function comes from, and to avoid name clashes.


### Standard library

Gleam has a rich and well-documented standard library. The documentation is available online at [hexdocs.pm/gleam_stdlib][docs]. Save this link somewhere - you will use it a lot!

Most built-in data types have a corresponding module that offers functions for working with that data type, e.g. there's the `gleam/int` module for ints, `gleam/string` module for strings, `gleam/list` module for lists and so on.

[docs]: https://hexdocs.pm/gleam_stdlib/

## Instructions

In this exercise you're going to write some code to help Betty's Bike Shop, an online shop for bikes and parts.
You have three tasks, aiming at correctly displaying the bikes and parts prices on the website.

## 1. Export the `pence_to_pounds` function

Your colleague has already written the skeleton of the module, the incomplete functions `pence_to_pounds` and `pounds_to_string`.
However, they have forgotten to export the `pence_to_pounds` function, so it is currently not visible by other modules or by the test suite.

Export the `pence_to_pounds` function.

## 2. Convert pence to pounds

Currently, the price is stored as an integer number of *pence* (the bike shop is based in the UK).
On the website, we want to show the price in *pounds*, where 1.00 pound amounts to 100 pence.
Your first task is to implement the `pence_to_pounds` function, taking an `Int` amount of pence, and converting it into its equivalent pounds as a `Float`.
You should also add type annotations for that function.

```gleam
pence_to_pounds(106)
// -> 1.06
```

## 3. Format the price for display on the website

Since Betty's bikes are sold in pounds, prices should be displayed with the symbol "£".
Your second task is thus to implement the `pounds_to_string` function, taking an amount of pounds as a `Float` and returning its price displayed as a `String` with the pound symbol prepended.

You should import the `gleam/float` and `gleam/string` modules before using them.

You should also define the type annotation for `pounds_to_string`.

```gleam
pounds_to_string(1.06)
// -> "£1.06"
```

## Source

### Created by

- @lpil