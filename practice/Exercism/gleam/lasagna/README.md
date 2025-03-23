# Lasagna

Welcome to Lasagna on Exercism's Gleam Track.
If you need help running the tests or submitting your code, check out `HELP.md`.
If you get stuck on the exercise, check out `HINTS.md`, but try and solve it without using those first :)

## Introduction

## Basics

### Functions

In Gleam functions are defined using the `pub fn` syntax.

```gleam
pub fn add(x: Int, y: Int) -> Int {
  x + y
}
```

This function takes two arguments, both of type `Int`, and returns a value of type `Int`. There is no `return` keyword in Gleam, the value of the last expression in a function is always _implicitly returned_.

The type annotations for arguments and the return type are optional, and Gleam will always fully type check your code. Typically Gleam programmers will give their functions type annotations for clarity, but you may omit them if you wish.

```gleam
pub fn add(x, y) {
  x + y
}
```

A function can be called using the `function_name(argument1, argument2)` syntax.

```gleam
pub fn double(x: Int) -> Int {
  // Call the add function defined above
  add(x, x)
}
```

### Variables

In Gleam variables are defined using the `let name = expression` syntax.

```gleam
pub fn main() {
  let count = 1
}
```

Variables can be declared with type annotations. Like function arguments these are optional, though most Gleam programmers will omit type annotations for variables for brevity.

```gleam
pub fn main() {
  let count: Int = 1
}
```

### String literals

In Gleam strings are written using double quotes.

```gleam
pub fn greeting() {
  "Hello, world!"
}
```

### Code comments

Comments can be used to leave notes for other developers reading the source code. Comments in Gleam are single lines preceeded by `//`.

```gleam
pub fn main() {
  // This is a comment
  let x = 1
}
```

## Instructions

In this exercise you're going to write some code to help you cook a brilliant lasagna from your favorite cooking book.

You have five tasks, all related to the time spent cooking the lasagna.

## 1. Define the expected oven time in minutes

Define the `expected_minutes_in_oven` function that does not take any arguments and returns how many minutes the lasagna should be in the oven. According to the cooking book, the expected oven time in minutes is 40:

```gleam
expected_minutes_in_oven()
// -> 40
```

## 2. Calculate the remaining oven time in minutes

Define the `remaining_minutes_in_oven` function that takes the actual minutes the lasagna has been in the oven as an argument and returns how many minutes the lasagna still has to remain in the oven, based on the expected oven time in minutes from the previous task.

```gleam
remaining_minutes_in_oven(30)
// -> 10
```

## 3. Calculate the preparation time in minutes

Define the `preparation_time_in_minutes` function that takes the number of layers you added to the lasagna as an argument and returns how many minutes you spent preparing the lasagna, assuming each layer takes you 2 minutes to prepare.

```gleam
preparation_time_in_minutes(2)
// -> 4
```

## 4. Calculate the total working time in minutes

Define the `total_time_in_minutes` function that takes two arguments: the first argument is the number of layers you added to the lasagna, and the second argument is the number of minutes the lasagna has been in the oven. The function should return how many minutes in total you've worked on cooking the lasagna, which is the sum of the preparation time in minutes, and the time in minutes the lasagna has spent in the oven at the moment.

```gleam
total_time_in_minutes(3, 10)
// -> 16
```

## 5. Create a notification that the lasagna is ready

Define the `alarm` function that does not take any arguments and returns a message indicating that the lasagna is ready to eat.

```gleam
alarm()
// -> "Ding!"
```

## Source

### Created by

- @lpil