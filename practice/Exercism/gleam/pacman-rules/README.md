# Pacman Rules

Welcome to Pacman Rules on Exercism's Gleam Track.
If you need help running the tests or submitting your code, check out `HELP.md`.
If you get stuck on the exercise, check out `HINTS.md`, but try and solve it without using those first :)

## Introduction

## Bools

Gleam represents true and false values with the `Bool` type. There are only two values: `True` and `False`. These values can be bound to a variable:

```gleam
let true_variable = True
let false_variable = False
```

The `&&`, `||`, and `!` operators can be used to manipulate boolean values:

```gleam
True && True  // -> True
True && False // -> False

False || True  // -> True
False || False // -> False

!False // -> True
!True  // -> False
```

The `&&` and `||` operators use short-circuit evaluation, which means that the expression on the right-hand side of the operator is only evaluated if needed.

Each of the operators has a different precedence, where `!` is evaluated before `&&` and `||`. Braces can be used to evaluate one part of the expression before the others:

```gleam
!True && False   // -> False
!{True && False} // -> True
```

## Instructions

In this exercise, you need to translate some rules from the classic game Pac-Man into Gleam functions.

You have four rules to translate, all related to the game states.

> Don't worry about how the arguments are derived, just focus on combining the arguments to return the intended result.

## 1. Define if Pac-Man eats a ghost

Define the `eat_ghost` function that takes two arguments (_if Pac-Man has a power pellet active_ and _if Pac-Man is touching a ghost_) and returns a boolean value if Pac-Man is able to eat the ghost. The function should return `True` only if Pac-Man has a power pellet active and is touching a ghost.

```gleam
eat_ghost(False, True)
// -> False
```

## 2. Define if Pac-Man scores

Define the `score` function that takes two arguments (_if Pac-Man is touching a power pellet_ and _if Pac-Man is touching a dot_) and returns a boolean value if Pac-Man scored. The function should return `True` if Pac-Man is touching a power pellet or a dot.

```gleam
score(True, True)
// -> True
```

## 3. Define if Pac-Man loses

Define the `lose` function that takes two arguments (_if Pac-Man has a power pellet active_ and _if Pac-Man is touching a ghost_) and returns a boolean value if Pac-Man loses. The function should return `True` if Pac-Man is touching a ghost and does not have a power pellet active.

```gleam
lose(False, True)
// -> True
```

## 4. Define if Pac-Man wins

Define the `win` function that takes three arguments (_if Pac-Man has eaten all of the dots_, _if Pac-Man has a power pellet active_, and _if Pac-Man is touching a ghost_) and returns a boolean value if Pac-Man wins. The function should return `True` if Pac-Man has eaten all of the dots and has not lost based on the arguments defined in part 3.

```gleam
win(False, True, False)
// -> False
```

## Source

### Created by

- @lpil