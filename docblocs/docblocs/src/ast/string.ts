import * as expr from "./expr";
import { ExpressionVisitor, visit } from "./visit";
import { Tree, flatten, Dictionary } from "../util";

export function toString(e: expr.Expression): string {
  return flatten(visit(toStringVisitor, e)).join("");
}

var toStringVisitor: ExpressionVisitor<Tree<string>> = {

  visitUndefined(u: expr.Undefined): Tree<string> {
    return "undefined";
  },

  visitNull(n: expr.Null): Tree<string> {
    return "null";
  },

  visitBoolean(b: expr.Boolean): Tree<string> {
    return JSON.stringify(b.value);
  },

  visitNumber(n: expr.Number): Tree<string> {
    return JSON.stringify(n.value);
  },

  visitString(s: expr.String): Tree<string> {
    return JSON.stringify(s.value);
  },

  visitIdentifier(i: expr.Identifier): Tree<string> {
    return i.text;
  },

  visitProperty(
    this: ExpressionVisitor<Tree<string>>,
    p: expr.Property
  ): Tree<string> {

    return [
      visit(this, p.object),
      ".",
      visit(this, p.property)
    ];
  },

  visitIndex(
      this: ExpressionVisitor<Tree<string>>,
      i: expr.Index
    ): Tree<string> {

    return [
      visit(this, i.object),
      "[",
      visit(this, i.index),
      "]"
    ];
  },

  visitApplication(
    this: ExpressionVisitor<Tree<string>>,
    a: expr.Application
  ): Tree<string> {

    let arglist: Tree<string> = [];
    if (a.args.length > 0) {
      arglist.push(visit(this, a.args[0]));
      for (let i = 1, l = a.args.length; i < l; ++i) {
        arglist.push(", ");
        arglist.push(visit(this, a.args[i]));
      }
    }

    return [
      visit(this, a.fn),
      "(",
      arglist,
      ")"
    ];
  },

  visitUnaryOperation(
    this: ExpressionVisitor<Tree<string>>,
    u: expr.UnaryOperation
  ): Tree<string> {

    return [
      u.op,
      visit(this, u.right)
    ];
  },

  visitBinaryOperation(
    this: ExpressionVisitor<Tree<string>>,
    b: expr.BinaryOperation
  ): Tree<string> {

    return [
      visit(this, b.left),
      b.op,
      visit(this, b.right)
    ];
  },

  visitArrayConstruction(
    this: ExpressionVisitor<Tree<string>>,
    a: expr.ArrayConstruction
  ): Tree<string> {

    return JSON.stringify(a.value.map(e => visit(this, e)));
  },

  visitObjectConstruction(
    this: ExpressionVisitor<Tree<string>>,
    o: expr.ObjectConstruction
  ): Tree<string> {

    let elemdict: Dictionary<Tree<string>> = { };
    for (let key in o) {
      elemdict[key] = visit(this, o.value[key]);
    }
    return JSON.stringify(elemdict);
  }

}