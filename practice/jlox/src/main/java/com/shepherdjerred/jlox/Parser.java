package com.shepherdjerred.jlox;

import static com.shepherdjerred.jlox.TokenType.BANG;
import static com.shepherdjerred.jlox.TokenType.BANG_EQUAL;
import static com.shepherdjerred.jlox.TokenType.EOF;
import static com.shepherdjerred.jlox.TokenType.EQUAL_EQUAL;
import static com.shepherdjerred.jlox.TokenType.FALSE;
import static com.shepherdjerred.jlox.TokenType.GREATER;
import static com.shepherdjerred.jlox.TokenType.GREATER_EQUAL;
import static com.shepherdjerred.jlox.TokenType.LEFT_PAREN;
import static com.shepherdjerred.jlox.TokenType.LESS;
import static com.shepherdjerred.jlox.TokenType.LESS_EQUAL;
import static com.shepherdjerred.jlox.TokenType.MINUS;
import static com.shepherdjerred.jlox.TokenType.NIL;
import static com.shepherdjerred.jlox.TokenType.NUMBER;
import static com.shepherdjerred.jlox.TokenType.PLUS;
import static com.shepherdjerred.jlox.TokenType.RIGHT_PAREN;
import static com.shepherdjerred.jlox.TokenType.SEMICOLON;
import static com.shepherdjerred.jlox.TokenType.SLASH;
import static com.shepherdjerred.jlox.TokenType.STAR;
import static com.shepherdjerred.jlox.TokenType.STRING;
import static com.shepherdjerred.jlox.TokenType.TRUE;

import java.util.List;

public class Parser {

  private final List<Token> tokens;
  private int current = 0;

  Parser(List<Token> tokens) {
    this.tokens = tokens;
  }

  Expr parse() {
    try {
      return expression();
    } catch (ParseException error) {
      return null;
    }
  }

  private Expr expression() {
    return equality();
  }

  private Expr equality() {
    Expr expr = comparison();

    while (match(BANG_EQUAL, EQUAL_EQUAL)) {
      Token operator = previous();
      Expr right = comparison();
      expr = new Expr.Binary(expr, operator, right);
    }

    return expr;
  }

  private Expr comparison() {
    Expr expr = addition();

    while (match(GREATER, GREATER_EQUAL, LESS, LESS_EQUAL)) {
      Token operator = previous();
      Expr right = addition();
      expr = new Expr.Binary(expr, operator, right);
    }

    return expr;
  }

  private Expr addition() {
    Expr expr = multiplication();

    while (match(MINUS, PLUS)) {
      Token operator = previous();
      Expr right = multiplication();
      expr = new Expr.Binary(expr, operator, right);
    }

    return expr;
  }

  private Expr multiplication() {
    Expr expr = unary();

    while (match(SLASH, STAR)) {
      Token operator = previous();
      Expr right = unary();
      expr = new Expr.Binary(expr, operator, right);
    }

    return expr;
  }

  private Expr unary() {
    if (match(BANG, MINUS)) {
      Token operator = previous();
      Expr right = unary();
      return new Expr.Unary(operator, right);
    }

    return primary();
  }

  private Expr primary() {
    if (match(FALSE)) {
      return new Expr.Literal(false);
    }
    if (match(TRUE)) {
      return new Expr.Literal(true);
    }
    if (match(NIL)) {
      return new Expr.Literal(null);
    }

    if (match(NUMBER, STRING)) {
      return new Expr.Literal(previous().literal);
    }

    if (match(LEFT_PAREN)) {
      Expr expr = expression();
      consume(RIGHT_PAREN, "Expect ')' after expression.");
      return new Expr.Grouping(expr);
    }

    throw error(peek(), "Expect expression.");
  }

  private boolean match(TokenType... types) {
    for (TokenType type : types) {
      if (check(type)) {
        advance();
        return true;
      }
    }

    return false;
  }

  private Token consume(TokenType type, String message) {
    if (check(type)) {
      return advance();
    }

    throw error(peek(), message);
  }

  private boolean check(TokenType type) {
    if (isAtEnd()) {
      return false;
    }
    return peek().type == type;
  }

  private Token advance() {
    if (!isAtEnd()) {
      current++;
    }
    return previous();
  }

  private boolean isAtEnd() {
    return peek().type == EOF;
  }

  private Token peek() {
    return tokens.get(current);
  }

  private Token previous() {
    return tokens.get(current - 1);
  }

  private ParseException error(Token token, String message) {
    Main.error(token, message);
    return new ParseException();
  }

  private void synchronize() {
    advance();

    while (!isAtEnd()) {
      if (previous().type == SEMICOLON) {
        return;
      }

      switch (peek().type) {
        case CLASS:
        case FUN:
        case VAR:
        case FOR:
        case IF:
        case WHILE:
        case PRINT:
        case RETURN:
          return;
      }

      advance();
    }
  }
}
