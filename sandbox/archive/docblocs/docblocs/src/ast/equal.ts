import * as expr from "./expr";
import { ExpressionVisitor, visit } from "./visit";

export function equals(a: expr.Expression, b: expr.Expression) {
  return visit(equalVisitor, a)(b);
}

type EqualFunction = (e: expr.Expression) => boolean;

var equalVisitor: ExpressionVisitor<EqualFunction> = {
  visitUndefined(u: expr.Undefined): EqualFunction {
    return (e: expr.Expression) => e.type == "Undefined";
  },

  visitNull(n: expr.Null): EqualFunction {
    return (e: expr.Expression) => e.type == "Null";
  },

  visitBoolean(b: expr.Boolean): EqualFunction {
    return (e: expr.Expression) => e.type == "Boolean" && e.value == b.value;
  },

  visitNumber(n: expr.Number): EqualFunction {
    return (e: expr.Expression) => e.type == "Number" && e.value == n.value;
  },

  visitString(s: expr.String): EqualFunction {
    return (e: expr.Expression) => e.type == "String" && e.value == s.value;
  },

  visitIdentifier(i: expr.Identifier): EqualFunction {
    return (e: expr.Expression) => e.type == "Identifier" && e.text == i.text;
  },

  visitProperty(p: expr.Property): EqualFunction {
    return (e: expr.Expression) =>
      e.type == "Property" &&
      equals(e.object, p.object) &&
      this.visitIdentifier(e.property)(p.property);
  },

  visitIndex(i: expr.Index): EqualFunction {
    return (e: expr.Expression) =>
      e.type == "Index" &&
      equals(e.object, i.object) &&
      equals(e.index, i.index);
  },

  visitApplication(a: expr.Application): EqualFunction {
    return (e: expr.Expression) => {
      if (
        e.type != "Application" ||
        e.args.length != a.args.length ||
        !equals(e.fn, a.fn)
      ) {
        return false;
      }
      for (let i = 0, l = e.args.length; i < l; ++i) {
        if (!equals(e.args[i], a.args[i])) {
          return false;
        }
      }
      return true;
    };
  },

  visitUnaryOperation(u: expr.UnaryOperation): EqualFunction {
    return (e: expr.Expression) =>
      e.type == "UnaryOperation" && e.op == u.op && equals(e.right, u.right);
  },

  visitBinaryOperation(b: expr.BinaryOperation): EqualFunction {
    return (e: expr.Expression) =>
      e.type == "BinaryOperation" &&
      e.op == b.op &&
      equals(e.left, b.left) &&
      equals(e.right, b.right);
  },

  visitArrayConstruction(a: expr.ArrayConstruction): EqualFunction {
    return (e: expr.Expression) => {
      if (e.type != "ArrayConstruction" || e.value.length != a.value.length) {
        return false;
      }
      for (let i = 0, l = e.value.length; i < l; ++i) {
        if (!equals(e.value[i], a.value[i])) {
          return false;
        }
      }
      return true;
    };
  },

  visitObjectConstruction(o: expr.ObjectConstruction): EqualFunction {
    let keys = Object.keys(o.value);
    return (e: expr.Expression) => {
      if (
        e.type != "ObjectConstruction" ||
        Object.keys(e.value).length != keys.length
      ) {
        return false;
      }
      for (let key of keys) {
        if (!(key in e.value) || !equals(e.value[key], o.value[key])) {
          return false;
        }
      }
      return true;
    };
  },
};
