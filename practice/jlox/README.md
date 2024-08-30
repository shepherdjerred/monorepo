# lox
Implementation of the Lox programming language from the [Crafting Interpreters](https://craftinginterpreters.com/) book.

Lox is a simple high-level, C-based, dynamically typed language with classical inheritance.

## Grammar
```
program   → statement* EOF ;

statement → exprStmt
          | printStmt ;

exprStmt  → expression ";" ;
printStmt → "print" expression ";" ;

expression → literal
           | unary
           | binary
           | grouping ;

literal    → NUMBER | STRING | "true" | "false" | "nil" ;
grouping   → "(" expression ")" ;
unary      → ( "-" | "!" ) expression ;
binary     → expression operator expression ;
operator   → "==" | "!=" | "<" | "<=" | ">" | ">="
           | "+"  | "-"  | "*" | "/" ;
```
