package com.shepherdjerred.jlox;

import com.shepherdjerred.jlox.Expr.Binary;
import com.shepherdjerred.jlox.Expr.Grouping;
import com.shepherdjerred.jlox.Expr.Literal;
import com.shepherdjerred.jlox.Expr.Unary;
import com.shepherdjerred.jlox.Expr.Visitor;

public class Interpreter implements Visitor<Object> {

  void interpret(Expr Expr) {
    try {
      Object value = evaluate(Expr);
      System.out.println(stringify(value));
    } catch (InterpreterException error) {
      Main.runtimeError(error);
    }
  }

  @Override
  public Object visitBinaryExpr(Binary expression) {
    Object left = evaluate(expression.left);
    Object right = evaluate(expression.right);

    switch (expression.operator.type) {
      case GREATER:
        checkNumberOperands(expression.operator, left, right);
        return (double) left > (double) right;
      case GREATER_EQUAL:
        checkNumberOperands(expression.operator, left, right);
        return (double) left >= (double) right;
      case LESS:
        checkNumberOperands(expression.operator, left, right);
        return (double) left < (double) right;
      case LESS_EQUAL:
        checkNumberOperands(expression.operator, left, right);
        return (double) left <= (double) right;
      case MINUS:
        checkNumberOperands(expression.operator, left, right);
        return (double) left - (double) right;
      case PLUS:
        if (left instanceof Double && right instanceof Double) {
          return (double) left + (double) right;
        }
        if (left instanceof String && right instanceof String) {
          return (String) left + (String) right;
        }
        throw new InterpreterException(expression.operator,
            "Operands must be two numbers or two strings.");
      case SLASH:
        checkNumberOperands(expression.operator, left, right);
        return (double) left / (double) right;
      case STAR:
        checkNumberOperands(expression.operator, left, right);
        return (double) left * (double) right;
      case BANG_EQUAL:
        return !isEqual(left, right);
      case EQUAL_EQUAL:
        return isEqual(left, right);
      default:
        throw new RuntimeException("Unknown operator " + expression.operator);
    }
  }

  @Override
  public Object visitGroupingExpr(Grouping expression) {
    return evaluate(expression.expression);
  }

  @Override
  public Object visitLiteralExpr(Literal expression) {
    return expression.value;
  }

  @Override
  public Object visitUnaryExpr(Unary expression) {
    Object right = evaluate(expression.right);

    switch (expression.operator.type) {
      case BANG:
        return !isTruthy(right);
      case MINUS:
        checkNumberOperand(expression.operator, right);
        return -(double) right;
      default:
        throw new RuntimeException("Unknown operator " + expression.operator);
    }

  }

  private void checkNumberOperand(Token operator, Object operand) {
    if (operand instanceof Double) {
      return;
    }
    throw new InterpreterException(operator, "Operand must be a number.");
  }


  private void checkNumberOperands(Token operator, Object left, Object right) {
    if (left instanceof Double && right instanceof Double) {
      return;
    }
    throw new InterpreterException(operator, "Operands must be numbers.");
  }

  private boolean isTruthy(Object object) {
    if (object == null) {
      return false;
    }
    if (object instanceof Boolean) {
      return (boolean) object;
    }
    return true;
  }

  private boolean isEqual(Object a, Object b) {
    // nil is only equal to nil.
    if (a == null && b == null) {
      return true;
    }
    if (a == null) {
      return false;
    }

    return a.equals(b);
  }

  private String stringify(Object object) {
    if (object == null) {
      return "nil";
    }

    // Hack. Work around Java adding ".0" to integer-valued doubles.
    if (object instanceof Double) {
      String text = object.toString();
      if (text.endsWith(".0")) {
        text = text.substring(0, text.length() - 2);
      }
      return text;
    }

    return object.toString();
  }

  private Object evaluate(Expr expression) {
    return expression.accept(this);
  }
}
