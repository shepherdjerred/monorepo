package com.shepherdjerred.jlox;

import static com.shepherdjerred.jlox.TokenType.AND;
import static com.shepherdjerred.jlox.TokenType.BANG;
import static com.shepherdjerred.jlox.TokenType.BANG_EQUAL;
import static com.shepherdjerred.jlox.TokenType.CLASS;
import static com.shepherdjerred.jlox.TokenType.COMMA;
import static com.shepherdjerred.jlox.TokenType.DOT;
import static com.shepherdjerred.jlox.TokenType.ELSE;
import static com.shepherdjerred.jlox.TokenType.EOF;
import static com.shepherdjerred.jlox.TokenType.EQUAL;
import static com.shepherdjerred.jlox.TokenType.EQUAL_EQUAL;
import static com.shepherdjerred.jlox.TokenType.FALSE;
import static com.shepherdjerred.jlox.TokenType.FOR;
import static com.shepherdjerred.jlox.TokenType.FUN;
import static com.shepherdjerred.jlox.TokenType.GREATER;
import static com.shepherdjerred.jlox.TokenType.GREATER_EQUAL;
import static com.shepherdjerred.jlox.TokenType.IDENTIFIER;
import static com.shepherdjerred.jlox.TokenType.IF;
import static com.shepherdjerred.jlox.TokenType.LEFT_BRACE;
import static com.shepherdjerred.jlox.TokenType.LEFT_PAREN;
import static com.shepherdjerred.jlox.TokenType.LESS;
import static com.shepherdjerred.jlox.TokenType.LESS_EQUAL;
import static com.shepherdjerred.jlox.TokenType.MINUS;
import static com.shepherdjerred.jlox.TokenType.NIL;
import static com.shepherdjerred.jlox.TokenType.NUMBER;
import static com.shepherdjerred.jlox.TokenType.OR;
import static com.shepherdjerred.jlox.TokenType.PLUS;
import static com.shepherdjerred.jlox.TokenType.PRINT;
import static com.shepherdjerred.jlox.TokenType.RETURN;
import static com.shepherdjerred.jlox.TokenType.RIGHT_BRACE;
import static com.shepherdjerred.jlox.TokenType.RIGHT_PAREN;
import static com.shepherdjerred.jlox.TokenType.SEMICOLON;
import static com.shepherdjerred.jlox.TokenType.SLASH;
import static com.shepherdjerred.jlox.TokenType.STAR;
import static com.shepherdjerred.jlox.TokenType.STRING;
import static com.shepherdjerred.jlox.TokenType.SUPER;
import static com.shepherdjerred.jlox.TokenType.THIS;
import static com.shepherdjerred.jlox.TokenType.TRUE;
import static com.shepherdjerred.jlox.TokenType.VAR;
import static com.shepherdjerred.jlox.TokenType.WHILE;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Scanner {

  private static final Map<String, TokenType> keywords;

  static {
    keywords = new HashMap<>();
    keywords.put("and", AND);
    keywords.put("class", CLASS);
    keywords.put("else", ELSE);
    keywords.put("false", FALSE);
    keywords.put("for", FOR);
    keywords.put("fun", FUN);
    keywords.put("if", IF);
    keywords.put("nil", NIL);
    keywords.put("or", OR);
    keywords.put("print", PRINT);
    keywords.put("return", RETURN);
    keywords.put("super", SUPER);
    keywords.put("this", THIS);
    keywords.put("true", TRUE);
    keywords.put("var", VAR);
    keywords.put("while", WHILE);
  }

  private final String source;
  private final List<Token> tokens = new ArrayList<>();
  private int start = 0;
  private int current = 0;
  private int line = 1;

  Scanner(String source) {
    this.source = source;
  }

  List<Token> scanTokens() {
    while (!isAtEnd()) {
      // We are at the beginning of the next lexeme.
      start = current;
      scanToken();
    }

    tokens.add(new Token(EOF, "", null, line));
    return tokens;
  }

  private void scanToken() {
    char c = advance();
    switch (c) {
      case '(':
        addToken(LEFT_PAREN);
        break;
      case ')':
        addToken(RIGHT_PAREN);
        break;
      case '{':
        addToken(LEFT_BRACE);
        break;
      case '}':
        addToken(RIGHT_BRACE);
        break;
      case ',':
        addToken(COMMA);
        break;
      case '.':
        addToken(DOT);
        break;
      case '-':
        addToken(MINUS);
        break;
      case '+':
        addToken(PLUS);
        break;
      case ';':
        addToken(SEMICOLON);
        break;
      case '*':
        addToken(STAR);
        break;
      case '!':
        addToken(match('=') ? BANG_EQUAL : BANG);
        break;
      case '=':
        addToken(match('=') ? EQUAL_EQUAL : EQUAL);
        break;
      case '<':
        addToken(match('=') ? LESS_EQUAL : LESS);
        break;
      case '>':
        addToken(match('=') ? GREATER_EQUAL : GREATER);
        break;
      case '/':
        if (match('/')) {
          // A comment goes until the end of the line.
          while (peek() != '\n' && !isAtEnd()) {
            advance();
          }
        } else {
          addToken(SLASH);
        }
        break;

      case ' ':
      case '\r':
      case '\t':
        // Ignore whitespace.
        break;
      case '\n':
        line++;
        break;
      case '"':
        string();
        break;
      default:
        if (isDigit(c)) {
          number();
        } else if (isAlpha(c)) {
          identifier();
        } else {
          Main.error(line, "Unexpected character.");
        }
        break;
    }
  }

  private void identifier() {
    while (isAlphaNumeric(peek())) {
      advance();
    }

    // See if the identifier is a reserved word.
    String text = source.substring(start, current);

    TokenType type = keywords.get(text);
    if (type == null) {
      type = IDENTIFIER;
    }
    addToken(type);
  }

  private void number() {
    while (isDigit(peek())) {
      advance();
    }

    // Look for a fractional part.
    if (peek() == '.' && isDigit(peekNext())) {
      // Consume the "."
      advance();

      while (isDigit(peek())) {
        advance();
      }
    }

    addToken(NUMBER,
        Double.parseDouble(source.substring(start, current)));
  }

  private void string() {
    while (peek() != '"' && !isAtEnd()) {
      if (peek() == '\n') {
        line++;
      }
      advance();
    }

    // Unterminated string.
    if (isAtEnd()) {
      Main.error(line, "Unterminated string.");
      return;
    }

    // The closing ".
    advance();

    // Trim the surrounding quotes.
    String value = source.substring(start + 1, current - 1);
    addToken(STRING, value);
  }

  private boolean match(char expected) {
    if (isAtEnd()) {
      return false;
    }
    if (source.charAt(current) != expected) {
      return false;
    }

    current++;
    return true;
  }

  private char peek() {
    if (isAtEnd()) {
      return '\0';
    }
    return source.charAt(current);
  }

  private char peekNext() {
    if (current + 1 >= source.length()) {
      return '\0';
    }
    return source.charAt(current + 1);
  }

  private boolean isAlpha(char c) {
    return (c >= 'a' && c <= 'z')
        || (c >= 'A' && c <= 'Z')
        || c == '_';
  }

  private boolean isAlphaNumeric(char c) {
    return isAlpha(c) || isDigit(c);
  }

  private boolean isDigit(char c) {
    return c >= '0' && c <= '9';
  }

  private boolean isAtEnd() {
    return current >= source.length();
  }

  private char advance() {
    current++;
    return source.charAt(current - 1);
  }

  private void addToken(TokenType type) {
    addToken(type, null);
  }

  private void addToken(TokenType type, Object literal) {
    String text = source.substring(start, current);
    tokens.add(new Token(type, text, literal, line));
  }
}
