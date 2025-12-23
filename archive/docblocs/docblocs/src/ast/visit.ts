import * as expr from "./expr";

export interface ExpressionVisitor<T> {
  visitUndefined(u: expr.Undefined): T;
  visitNull(n: expr.Null): T;
  visitBoolean(b: expr.Boolean): T;
  visitNumber(n: expr.Number): T;
  visitString(s: expr.String): T;
  visitIdentifier(i: expr.Identifier): T;
  visitProperty(p: expr.Property): T;
  visitIndex(i: expr.Index): T;
  visitApplication(a: expr.Application): T;
  visitUnaryOperation(u: expr.UnaryOperation): T;
  visitBinaryOperation(b: expr.BinaryOperation): T;
  visitArrayConstruction(a: expr.ArrayConstruction): T;
  visitObjectConstruction(o: expr.ObjectConstruction): T;
}

export function visit<T>(visitor: ExpressionVisitor<T>, expr: expr.Expression):T {
  switch (expr.type) {
    case "Undefined":          return visitor.visitUndefined(expr);
    case "Null":               return visitor.visitNull(expr);
    case "Boolean":            return visitor.visitBoolean(expr);
    case "Number":             return visitor.visitNumber(expr);
    case "String":             return visitor.visitString(expr);
    case "Identifier":         return visitor.visitIdentifier(expr);
    case "Property":           return visitor.visitProperty(expr);
    case "Index":              return visitor.visitIndex(expr);
    case "Application":        return visitor.visitApplication(expr);
    case "UnaryOperation":     return visitor.visitUnaryOperation(expr);
    case "BinaryOperation":    return visitor.visitBinaryOperation(expr);
    case "ArrayConstruction":  return visitor.visitArrayConstruction(expr);
    case "ObjectConstruction": return visitor.visitObjectConstruction(expr);
  }
}
