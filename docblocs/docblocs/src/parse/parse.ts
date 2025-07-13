import * as ast from "../ast";
import { Maybe,
         Dictionary,
         Stack         } from "../util";
import { ParseError    } from "./error";
import { BlocStack,
         ContainerBloc } from "./blocstack";
import { Token         } from "./token";

const precedences: Dictionary<number> = {
  "*" : 80,
  "/" : 80,
  "%" : 80,
  "+" : 70,
  "-" : 70,
  "<" : 60,
  "<=": 60,
  ">" : 60,
  ">=": 60,
  "==": 50,
  "!=": 50,
  "&&": 30,
  "||": 20,
  "|" : 10
};

interface BlocMods {
  comment?: boolean;
  open?: boolean;
  close?: boolean;
  implicit?: boolean;
  property?: boolean;
}

export function parse(text: string, source?: string): ast.Template {
  /** Current position (index) in the text. */
  let curPos = 0;

  /** Current location in the source. */
  let curLoc = {line: 1, char: 1};

  /** Position (index) of the end of the text. */
  let endPos = text.length;

  /** The last position where we skipped whitespace. */
  let lastSkip = -1;

  /** The root bloc for this template */
  let rootBloc = ast.RootBloc(source);

  /** The identifier for the root bloc */
  const rootId = "*root*";

  /** Stack for nesting of blocs.  */
  let stack = new BlocStack();
  stack.push(rootBloc, ast.Identifier(curLoc, rootId));

  /** Last regular expression that was matched. */
  let lastRegexp: RegExp;

  /** Match results from last regular expression that was matched. */
  let lastMatch: RegExpMatchArray;

  try {

    // Parse unitl there's nothing left
    while (curPos < endPos) {
      parseText();
      parseBloc();
    }

    // Should be left with just one thing on the stack
    stack.pop(ast.Identifier(curLoc, rootId));
    if (rootBloc.contents.children.length == 1) {
      let child = rootBloc.contents.children[0];
      if (typeof child != "string" &&
          child.type == "Bloc" &&
          child.expression.type == "Identifier" &&
          child.expression.text == "template" &&
          child.contents                          ) {
        return child.contents;
      }
    }
    return rootBloc.contents;

  }
  catch (e) {
    if (source) {
      e.fileName = source;
    }
    throw e;
  }

  /**
   * Parse a text section (i.e., not a bloc).
   * If successful, it is added to current template.
   */
  function parseText() {
    let data = match(/([^\[]|\[(?!\[))+/y);
    if (data) {
      stack.bloc.contents.children.push(data[0]);
      advance();
    }
  }

  /**
   * Parse a bloc.
   * If successful, it is added to current template.
   */
  function parseBloc() {
    let opening = parseToken("[[");
    if (opening) {
      let closed = false;
      try {
        let mods = parseBlocMods();
        if (mods.comment) {
          parseBlocComment(opening);
          closed = true;
        }
        else {
          let bloc = parseBlocContents(opening, mods);
          let params = parseBlocParams(mods);
          let firstExpr, firstParams;
          if (mods.property && ! params) {
            firstExpr = parseExpression();
            if (firstExpr) {
              firstParams = parseBlocParams(mods);
            }
          }

          if (! parseToken("]]")) {
            throw new ParseError("Unexpected character in bloc", curLoc);
          }
          closed = true;

          if (bloc.type == "Bloc") {
            if (mods.open || mods.close) {
              removeBlankLine();
            }
            completeBloc(bloc, mods, params);
          }
          else {
            removeBlankLine();
            completeDefinition(bloc, mods, params);
            if (firstExpr) {
              completeBloc(
                ast.Bloc(opening, firstExpr),
                { open: true, implicit: true },
                firstParams
              )
            }
          }
        }
      }
      finally {
        if (! closed && match(/(\]|\](?!\]))*]]/y)) {
          advance();
        }
      }
    }
  }

  /**
   */
  function parseBlocMods(): BlocMods {
    let blocMods = match(/#|\+:?|\*:?|-/y);
    if (blocMods) {
      advance();
      switch (blocMods[0]) {
        case "#":  return { comment: true };
        case "+":  return { open: true };
        case "+:": return { open: true, property: true };
        case "*":  return { open: true, implicit: true };
        case "*:": return { open: true, implicit: true, property: true };
        case "-":  return { close: true };
      }
    }
    return { };
  }

  /**
   */
  function parseBlocComment(opening: Token) {
    let end = match(/([^#]|#(?!]]))*(#]])?/y);
    advance();
    if (!end || !end[2]) {
      throw new ParseError("Unterminated comment", opening);
    }
  }

  /**
   */
  function parseBlocContents(opening: Token, mods: BlocMods): ast.Bloc | ast.Definition {
    let expr = parseExpression();
    if (!expr) {
      throw new ParseError("Expected bloc expression", curLoc);
    }

    let colon = parseToken(":");
    if (colon) {
      if (mods.property) {
        throw new ParseError("Property definition cannot both open with : and contain :", colon);
      }
      if (expr.type != "Identifier") {
        throw new ParseError("Bloc property must be an identifier", expr);
      }

      let id = expr;
      expr = parseExpression();
      if (!expr) {
        throw new ParseError("Expected expression for property value", curLoc);
      }

      return ast.Definition(opening, id, expr);
    }
    else if (mods.property) {
      if (expr.type != "Identifier") {
        throw new ParseError("Bloc property must be an identifier", expr);
      }
      return ast.Definition(opening, expr);
    }
    else {
      return ast.Bloc(opening, expr);
    }
  }

  /**
   */
  function parseBlocParams(mods: BlocMods): Maybe<ast.TemplateParamList> {
    let arrow = parseToken("->") || parseToken("=>");
    if (arrow) {
      if (!mods.open) {
        throw new ParseError("Only opening blocs can have parameters", arrow);
      }
      let identifiers = parseSequence(parseIdentifier, "parameter name");
      if (! identifiers) {
        throw new ParseError("Expected parameter list", curLoc);
      }
      let type: "local" | "global" = arrow.text == "->" ? "local" : "global";
      return ast.TemplateParamList(arrow, type, identifiers);
    }
  }

  /**
   */
  function completeBloc(bloc: ast.Bloc, mods: BlocMods, params?: ast.TemplateParamList) {
    // Only possibilities at this point are: open, open+implicit, close, and nothing
    if (mods.open) {
      // Add bloc to template
      stack.bloc.contents.children.push(bloc);

      // Now parsing this bloc's contents
      bloc.contents = ast.Template(curLoc, params);
      let id = mods.implicit ? null : bloc.expression;
      stack.push(bloc as ContainerBloc, id);
    }
    else if (mods.close) {
      // Finished parsing contents; go back to previous template
      stack.pop(bloc.expression);
    }
    else {
      // Add bloc to template, continue parsing same template
      stack.bloc.contents.children.push(bloc);
    }
  }

  /**
   */
  function completeDefinition(defn: ast.Definition, mods: BlocMods, params?: ast.TemplateParamList) {
    // Only possibilities at this point are: open, open+implicit, and nothing

    if (stack.bloc.type == "Definition") {
      throw new ParseError("Bloc property may not contain nested properties", defn);
    }
    if (stack.bloc.type == "RootBloc") {
      throw new ParseError("Root bloc may not contain properties", defn);
    }

    // Add definition to current bloc
    if (stack.bloc.properties) {
      stack.bloc.properties.push(defn);
    }
    else {
      stack.bloc.properties = [ defn ];
    }

    if (mods.open) {
      // Now parsing this bloc's contents
      defn.contents = ast.Template(curLoc, params);
      let id = mods.implicit ? null : defn.target;
      stack.push(defn as ContainerBloc, id);
    }
  }

  /**
   */
  function parseExpression(): Maybe<ast.Expression> {
    let valStack: Stack<ast.Expression> = [];
    let opStack: Stack<Token> = [];

    let primary = parsePrimary();
    if (primary) {
      Stack.push(valStack, primary);
      let op = parseBinary();
      while (op) {
        primary = parsePrimary();
        if (primary) {
          while (opStack.top && precedences[opStack.top.text] >= precedences[op.text]) {
            let op = Stack.pop(opStack);
            let right = Stack.pop(valStack);
            let left = Stack.pop(valStack);
            Stack.push(valStack, ast.BinaryOperation(op, left, op.text, right));
          }

          Stack.push(opStack, op);
          Stack.push(valStack, primary);
        }
        else {
          throw new ParseError('Expected operand', curLoc);
        }

        op = parseBinary();
      }

      while (opStack.top) {
        let op = Stack.pop(opStack);
        let right = Stack.pop(valStack);
        let left = Stack.pop(valStack);
        Stack.push(valStack, ast.BinaryOperation(op, left, op.text, right));
      }

      return Stack.pop(valStack);
    }
  }

  /**
   */
  function parseBinary(): Maybe<Token> {
    skipWs();
    let binop = match(/[*\/%+]|-(?!>)|<=?|>=?|[!=]=|&&|\|\|?/y);
    if (binop) {
      let token = Token(curLoc, binop[0]);
      advance();
      return token;
    }
  }

  /**
   * Primary := UnaryOp Primary
   *          | Number
   *          | String
   *          | Identifer Deref
   *          | Nested Deref
   * Deref := Empty
   *      | Property Deref
   *      | Call Deref
   *      | Index Deref
   *      | Extend Deref
   */
  function parsePrimary(): Maybe<ast.Expression> {
    let opstack: Stack<Token> = [];
    let op = parseUnary();
    while (op) {
      Stack.push(opstack, op);
      op = parseUnary();
    }

    let expr: Maybe<ast.Expression> =
      parseUndefined() || parseNull() || parseBoolean() || parseNumber() ||
      parseString() || parseArrayConstruction() || parseObjectConstruction() ||
      parseIdentifier() || parseNested();
    if (expr) {
      let next: Maybe<ast.Expression>;
      while (next = parseApplication(expr) ||
                    parseIndex(expr) ||
                    parseProperty(expr)      ) {
        expr = next;
      }
    }

    if (expr) {
      while (opstack.top) {
        let op = Stack.pop(opstack);
        expr = ast.UnaryOperation(op, op.text, expr);
      }
    }

    return expr;
  }

  /**
   */
  function parseUnary(): Maybe<Token> {
    skipWs();
    let unop = match(/[+\-!]/y);
    if (unop) {
      let token = Token(curLoc, unop[0]);
      advance();
      return token;
    }
  }

  /**
   * Application := "(" Params ")"
   *
   * Params := Empty | Expression RestOfParams
   *
   * RestOfParams := Empty | "," Expression RestOfParams
   */
  function parseApplication(left: ast.Expression): Maybe<ast.Application> {
    let lparen = parseToken("(");
    if (lparen) {
      let args = parseSequence(parseExpression, "expression");
      if (parseToken(")")) {
        return ast.Application(lparen, left, args || [],);
      }
      else {
        throw new ParseError("Expected closing parenthesis after argument list", curLoc);
      }
    }
  }

  /**
   * Index := "[" Expression "]"
   */
  function parseIndex(left: ast.Expression): Maybe<ast.Index> {
    let opening = parseToken("[");
    if (opening) {
      let expr = parseExpression();
      if (expr) {
        if (parseToken("]")) {
          return ast.Index(opening, left, expr);
        }
        else {
          throw new ParseError("Expected closing bracket for index", curLoc);
        }
      }
      else {
        throw new ParseError("Expected expression for index", curLoc);
      }
    }
  }

  /**
   * Property := "." Identifier
   */
  function parseProperty(left: ast.Expression): Maybe<ast.Property> {
    let dot = parseToken(".");
    if (dot) {
      let id = parseIdentifier();
      if (id) {
        return ast.Property(dot, left, id);
      }
      else {
        throw new ParseError("Expected identifier for property name", curLoc);
      }
    }
  }

  /**
   * Nested := "(" Expression ")"
   */
  function parseNested(): Maybe<ast.Expression> {
    let lparen = parseToken('(');
    if (lparen) {
      let expr = parseExpression();
      if (expr) {
        if (parseToken(')')) {
          return expr;
        }
        else {
          throw new ParseError(
            'Expected closing parenthesis after nested expression',
            curLoc
          );
        }
      }
      else {
        throw new ParseError(
          'Expected expression after opening parenthesis',
          curLoc
        );
      }
    }
  }

  /**
   */
  function parseObjectConstruction(): Maybe<ast.ObjectConstruction> {
    let opening = parseToken("{");
    if (opening) {
      let properties = parseSequence(parseKeyValue, "object property");
      let obj: Dictionary<ast.Expression> = {};
      if (properties) {
        for (let property of properties) {
          obj[property.key.text] = property.value;
        }
      }
      if (parseToken("}")) {
        return ast.ObjectConstruction(opening, obj);
      }
      else {
        throw new ParseError("Expected closing brace after object construction", curLoc);
      }
    }
  }

  /**
   */
  function parseKeyValue(): Maybe<{key: ast.Identifier, value: ast.Expression}> {
    let key = parseIdentifier();
    if (key) {
      if (parseToken(":")) {
        let value = parseExpression();
        if (value) {
          return { key, value };
        }
        else {
          throw new ParseError("Expected property value after colon", curLoc);
        }
      }
      else {
        throw new ParseError("Expected colon after property name", curLoc);
      }
    }
  }

  /**
   */
  function parseArrayConstruction(): Maybe<ast.ArrayConstruction> {
    let opening = parseToken("[");
    if (opening) {
      let arr = parseSequence(parseExpression, "value in array literal") || []
      if (parseToken("]")) {
        return ast.ArrayConstruction(opening, arr);
      }
      else {
        throw new ParseError("Expected closing bracket after array literal", curLoc);
      }
    }
  }

  /**
   */
  function parseIdentifier(): Maybe<ast.Identifier> {
    skipWs();
    let id = match(/[a-zA-Z_$][\w$]*/y);
    if (id) {
      if (id[0] == "true" || id[0] == "false" || id[0] == "null" || id[0] == "undefined") {
        let error = new ParseError(
          `Cannot use reserved word "${id[0]}" as identifier`,
          curLoc
        );
        advance();
        throw error;
      }
      else {
        let node = ast.Identifier(curLoc, id[0]);
        advance();
        return node;
      }
    }
  }

  /**
   */
  function parseString(): Maybe<ast.String> {
    skipWs();
    let str = match(/"((?:[^"\\\n]|\\(?:.|\n))*)("?)/y);
    if (str) {
      let unescaped = str[1].replace(/\\(.|\n)/g, (s, c) => {
        switch (c) {
          case 'n': return '\n';
          case 't': return '\t';
          default:  return c;
        }
      })
      let node = ast.String(curLoc, unescaped);
      advance();
      if (!str[2]) {
        throw new ParseError("Unterminated string literal", curLoc);
      }
      return node;
    }
  }

  /**
   */
  function parseNumber(): Maybe<ast.Number> {
    skipWs();
    let num = match(/(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/y);
    if (num) {
      let node = ast.Number(curLoc, Number(num[0]));
      advance();
      return node;
    }
  }

  /**
   */
  function parseBoolean(): Maybe<ast.Boolean> {
    skipWs();
    let bool = match(/(true|false)(?!\w)/y);
    if (bool) {
      let node = ast.Boolean(curLoc, bool[0] == "true");
      advance();
      return node;
    }
  }

  /**
   */
  function parseNull(): Maybe<ast.Null> {
    skipWs();
    let token = match(/null(?!\w)/y);
    if (token) {
      let node = ast.Null(curLoc);
      advance();
      return node;
    }
  }

  /**
   */
  function parseUndefined(): Maybe<ast.Undefined> {
    skipWs();
    let token = match(/undefined(?!\w)/y);
    if (token) {
      let node = ast.Undefined(curLoc);
      advance();
      return node;
    }
  }

  /**
   */
  function parseSequence<T>(parseT: () => Maybe<T>, description: string): Maybe<T[]> {
    let next = parseT();
    if (next) {
      let all = [next];
      while (parseToken(",")) {
        next = parseT();
        if (! next) {
          throw new ParseError(`Expected ${description}`, curLoc);
        }
        all.push(next);
      }
      return all;
    }
  }

  /**
   */
  function parseToken(value: string): Maybe<Token> {
    skipWs();
    let len = value.length;
    if (text.substr(curPos, len) == value) {
      let token = Token(curLoc, value);
      curLoc.char += len;
      curPos += len;
      return token;
    }
  }

  /**
   */
  function removeBlankLine() {
    let leading: RegExpMatchArray | null = null;
    let length = stack.bloc.contents.children.length;
    if (length > 0) {
      let last = stack.bloc.contents.children[length - 1];
      if (typeof last !== "string") {
        return;
      }
      leading = last.match(/^([^]*\n|)[ \t]*$/);
      if (! leading) {
        return;
      }
    }

    let trailing = match(/[ \t]*(\n|$)/y);
    if (! trailing) {
      return;
    }

    if (leading) {
      stack.bloc.contents.children[length - 1] = leading[1];
    }
    advance();
  }

  /**
   */
  function skipWs() {
    if (lastSkip != curPos) {
      if (match(/\s+/y)) {
        advance();
      }
      lastSkip = curPos;
    }
  }

  /**
   */
  function match(regexp: RegExp): RegExpMatchArray|null {
    if (! regexp.sticky) {
      throw new Error("Precondition violation: match called on non-sticky regexp: " + regexp);
    }
    regexp.lastIndex = curPos;
    let m = regexp.exec(text);
    if (m) {
      lastRegexp = regexp;
      lastMatch = m;
    }
    return m;
  }


  /**
   */
  function advance() {
    curPos = lastRegexp.lastIndex;
    countLines(lastMatch[0]);
  }


  /**
   */
  function countLines(text: string) {
    let lineCount = text.match(/\n/g);
    let colCount = (text.match(/.*$/) as RegExpMatchArray)[0];
    if (lineCount) {
      curLoc.line += lineCount.length;
      curLoc.char = 1 + colCount.length;
    }
    else {
      curLoc.char += colCount.length;
    }
  }

}