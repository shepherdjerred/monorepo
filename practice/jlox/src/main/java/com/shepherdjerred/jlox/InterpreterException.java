package com.shepherdjerred.jlox;

public class InterpreterException extends RuntimeException {
  final Token token;

  InterpreterException(Token token, String message) {
    super(message);
    this.token = token;
  }
}
