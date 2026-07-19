import {
  type ReportExpression,
  type ReportMetric,
  ReportMetricSchema,
  type ReportSelectItem,
} from "#src/model/report-query-spec.ts";

type Token =
  | { kind: "number"; value: string }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "comma" }
  | { kind: "leftParen" }
  | { kind: "rightParen" };

const ALIAS_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/u;
const FUNCTION_NAMES = new Set(["round", "coalesce", "per_game", "per_minute"]);

export function parseReportSelectItem(text: string): ReportSelectItem {
  const { expressionText, alias } = splitAlias(text.trim());
  const parser = new ExpressionParser(tokenize(expressionText));
  const expression = parser.parse();
  if (alias !== undefined) return { expression, key: alias, alias };
  if (expression.kind === "metric") {
    return { expression, key: expression.metric };
  }
  throw new Error("Calculated SELECT expressions require an AS alias.");
}

export function collectExpressionMetrics(
  expression: ReportExpression,
): ReportMetric[] {
  if (expression.kind === "metric") {
    return [expression.metric];
  }
  if (expression.kind === "number") {
    return [];
  }
  if (expression.kind === "binary") {
    return [
      ...collectExpressionMetrics(expression.left),
      ...collectExpressionMetrics(expression.right),
    ];
  }
  return expression.arguments.flatMap((argument) =>
    collectExpressionMetrics(argument),
  );
}

export function formatReportExpression(expression: ReportExpression): string {
  if (expression.kind === "metric") {
    return expression.metric;
  }
  if (expression.kind === "number") {
    return expression.value.toString();
  }
  if (expression.kind === "binary") {
    return `(${formatReportExpression(expression.left)} ${expression.operator} ${formatReportExpression(expression.right)})`;
  }
  return `${expression.name}(${expression.arguments
    .map((argument) => formatReportExpression(argument))
    .join(", ")})`;
}

function splitAlias(text: string): {
  expressionText: string;
  alias?: string | undefined;
} {
  let depth = 0;
  let aliasAt = -1;
  for (let index = 0; index < text.length - 3; index++) {
    const char = text[index];
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth === 0 && text.slice(index, index + 4).toLowerCase() === " as ") {
      aliasAt = index;
    }
  }
  if (aliasAt === -1) {
    return { expressionText: text };
  }
  const alias = text
    .slice(aliasAt + 4)
    .trim()
    .toLowerCase();
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(`Invalid SELECT alias "${alias}".`);
  }
  return { expressionText: text.slice(0, aliasAt).trim(), alias };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === undefined) break;
    if (/\s/u.test(char)) {
      index++;
      continue;
    }
    if (/\d|\./u.test(char)) {
      const match = /^\d+(?:\.\d+)?/u.exec(text.slice(index));
      if (match === null) {
        throw new Error(`Invalid number near "${text.slice(index)}".`);
      }
      tokens.push({ kind: "number", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (/[a-z_]/iu.test(char)) {
      const match = /^[a-z_]\w*/iu.exec(text.slice(index));
      if (match === null) {
        throw new Error(`Invalid identifier near "${text.slice(index)}".`);
      }
      tokens.push({ kind: "identifier", value: match[0].toLowerCase() });
      index += match[0].length;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "operator", value: char });
      index++;
      continue;
    }
    switch (char) {
      case ",":
        tokens.push({ kind: "comma" });
        break;
      case "(":
        tokens.push({ kind: "leftParen" });
        break;
      case ")":
        tokens.push({ kind: "rightParen" });
        break;
      default:
        throw new Error(`Unexpected character "${char}" in SELECT expression.`);
    }
    index++;
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ReportExpression {
    const expression = this.parseAdditive();
    if (this.peek() !== undefined) {
      throw new Error("Unexpected token after SELECT expression.");
    }
    return expression;
  }

  private parseAdditive(): ReportExpression {
    let expression = this.parseMultiplicative();
    while (this.operatorIs("+") || this.operatorIs("-")) {
      const operator = this.consumeOperator();
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseMultiplicative(),
      };
    }
    return expression;
  }

  private parseMultiplicative(): ReportExpression {
    let expression = this.parsePrimary();
    while (this.operatorIs("*") || this.operatorIs("/")) {
      const operator = this.consumeOperator();
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parsePrimary(),
      };
    }
    return expression;
  }

  private parsePrimary(): ReportExpression {
    const token = this.consume();
    if (token === undefined) {
      throw new Error("Expected a SELECT expression.");
    }
    if (token.kind === "number") {
      return { kind: "number", value: Number(token.value) };
    }
    if (token.kind === "leftParen") {
      return this.withDepth(() => {
        const expression = this.parseAdditive();
        this.expect("rightParen");
        return expression;
      });
    }
    if (token.kind !== "identifier") {
      throw new Error("Expected a metric, function, number, or parenthesis.");
    }
    if (this.peek()?.kind === "leftParen") {
      return this.parseFunction(token.value);
    }
    const metric = ReportMetricSchema.safeParse(token.value);
    if (!metric.success) {
      throw new Error(`Unknown metric "${token.value}".`);
    }
    return { kind: "metric", metric: metric.data };
  }

  private parseFunction(name: string): ReportExpression {
    if (!FUNCTION_NAMES.has(name)) {
      throw new Error(`Unknown ScoutQL function "${name}".`);
    }
    this.expect("leftParen");
    return this.withDepth(() => {
      const arguments_: ReportExpression[] = [];
      if (this.peek()?.kind !== "rightParen") {
        arguments_.push(this.parseAdditive());
        while (this.peek()?.kind === "comma") {
          this.consume();
          arguments_.push(this.parseAdditive());
        }
      }
      this.expect("rightParen");
      validateFunctionArguments(name, arguments_);
      if (
        name !== "round" &&
        name !== "coalesce" &&
        name !== "per_game" &&
        name !== "per_minute"
      ) {
        throw new Error(`Unknown ScoutQL function "${name}".`);
      }
      return { kind: "function", name, arguments: arguments_ };
    });
  }

  private withDepth<T>(callback: () => T): T {
    this.depth++;
    if (this.depth > 8) {
      throw new Error("ScoutQL expressions may nest at most 8 levels.");
    }
    try {
      return callback();
    } finally {
      this.depth--;
    }
  }

  private operatorIs(value: "+" | "-" | "*" | "/"): boolean {
    const token = this.peek();
    return token?.kind === "operator" && token.value === value;
  }

  private consumeOperator(): "+" | "-" | "*" | "/" {
    const token = this.consume();
    if (token?.kind !== "operator") {
      throw new Error("Expected an arithmetic operator.");
    }
    return token.value;
  }

  private expect(kind: Token["kind"]): void {
    const token = this.consume();
    if (token?.kind !== kind) {
      throw new Error(`Expected ${kind}.`);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token | undefined {
    const token = this.peek();
    this.index++;
    return token;
  }
}

function validateFunctionArguments(
  name: string,
  functionArguments: ReportExpression[],
): void {
  const valid =
    (name === "round" &&
      (functionArguments.length === 1 || functionArguments.length === 2)) ||
    (name === "coalesce" && functionArguments.length === 2) ||
    ((name === "per_game" || name === "per_minute") &&
      functionArguments.length === 1);
  if (!valid) {
    throw new Error(`Invalid argument count for ${name}.`);
  }
}
