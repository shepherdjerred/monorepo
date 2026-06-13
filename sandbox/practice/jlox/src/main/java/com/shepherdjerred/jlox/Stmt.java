package com.shepherdjerred.jlox;

abstract class Stmt {

  abstract <R> R accept(Visitor<R> visitor);

  interface Visitor<R> {

    R visitExprStmt(Expr stmt);

    R visitPrintStmt(Print stmt);
  }

  static class Expr extends Stmt {

    final Expr expression;

    Expr(Expr expression) {
      this.expression = expression;
    }

    <R> R accept(Visitor<R> visitor) {
      return visitor.visitExprStmt(this);
    }
  }

  static class Print extends Stmt {

    final Expr expression;

    Print(Expr expression) {
      this.expression = expression;
    }

    <R> R accept(Visitor<R> visitor) {
      return visitor.visitPrintStmt(this);
    }
  }
}
