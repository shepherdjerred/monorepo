package com.shepherdjerred.jlox;

import com.shepherdjerred.jlox.Expr.Literal;

public class SyntaxTreePrinter implements Expr.Visitor<String> {

  public static void main(String[] args) {
    Expr expression = new Expr.Binary(
        new Expr.Unary(
            new Token(TokenType.MINUS, "-", null, 1),
            new Expr.Literal(123)),
        new Token(TokenType.STAR, "*", null, 1),
        new Expr.Grouping(
            new Expr.Literal(45.67)));

    System.out.println(new SyntaxTreePrinter().print(expression));
  }

  String print(Expr expr) {
    return expr.accept(this);
  }

  @Override
  public String visitBinaryExpr(Expr.Binary expression) {
    return parenthesize(expression.operator.lexeme, expression.left, expression.right);
  }

  @Override
  public String visitGroupingExpr(Expr.Grouping expression) {
    return parenthesize("group", expression.expression);
  }

  @Override
  public String visitLiteralExpr(Literal expression) {
    if (expression.value == null) {
      return "nil";
    }
    return expression.value.toString();
  }

  @Override
  public String visitUnaryExpr(Expr.Unary expression) {
    return parenthesize(expression.operator.lexeme, expression.right);
  }

  private String parenthesize(String name, Expr... expressions) {
    StringBuilder builder = new StringBuilder();

    builder.append("(").append(name);
    for (Expr expr : expressions) {
      builder.append(" ");
      builder.append(expr.accept(this));
    }
    builder.append(")");

    return builder.toString();
  }
}
