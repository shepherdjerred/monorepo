type SyntaxNode =
  | { readonly kind: "atom"; readonly value: string }
  | {
      readonly kind: "brace" | "paren" | "bracket";
      readonly children: readonly SyntaxNode[];
    };

const TYPE_MODIFIERS = new Set(
  "public internal private protected file sealed abstract static partial unsafe new".split(
    " ",
  ),
);
const MEMBER_MODIFIERS = new Set([...TYPE_MODIFIERS, "virtual", "const"]);
const ACCESSOR_MODIFIERS = new Set(
  "public protected internal private".split(" "),
);
const ACCESSOR_NAMES = new Set(["get", "set", "init"]);
const COMPOUND_EQ_REGEX = /^(?:\?\?=|<<=|>>=|==|!=|<=|>=|[+\-*/%&|^]=)/u;
const SINGLE_DELIMITERS = "{}()[];=:,";

function skipRawStringLiteral(
  source: string,
  cursor: number,
): number | undefined {
  let count = 0;
  while (source[cursor + count] === '"') {
    count++;
  }
  const end = source.indexOf('"'.repeat(count), cursor + count);
  return end === -1 ? undefined : end + count;
}

function skipStandardQuotedLiteral(
  source: string,
  cursor: number,
  quote: string,
  verbatim: boolean,
): number | undefined {
  let pos = cursor + 1;
  while (pos < source.length) {
    const ch = source[pos];
    if (verbatim && ch === '"' && source[pos + 1] === '"') {
      pos += 2;
      continue;
    }
    if (!verbatim && ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === quote) {
      return pos + 1;
    }
    if (!verbatim && (ch === "\n" || ch === "\r")) {
      return undefined;
    }
    pos++;
  }
  return undefined;
}

function skipStringOrCharLiteral(
  source: string,
  start: number,
): number | undefined {
  let cursor = start;
  while (source[cursor] === "$" || source[cursor] === "@") {
    cursor++;
  }
  const quote = source[cursor];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }
  if (quote === '"' && source.startsWith('"""', cursor)) {
    return skipRawStringLiteral(source, cursor);
  }
  const verbatim = quote === '"' && source.slice(start, cursor).includes("@");
  return skipStandardQuotedLiteral(source, cursor, quote, verbatim);
}

function tokenizeNext(
  source: string,
  index: number,
): { readonly token?: string; readonly next: number } | undefined {
  const ch = source[index] ?? "";
  if (source.startsWith("//", index)) {
    const nl = source.indexOf("\n", index + 2);
    return { next: nl === -1 ? source.length : nl + 1 };
  }
  if (source.startsWith("/*", index)) {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? undefined : { next: end + 2 };
  }
  if (source.startsWith("=>", index)) {
    return undefined;
  }
  if (ch === '"' || ch === "'" || ch === "$" || ch === "@") {
    const litEnd = skipStringOrCharLiteral(source, index);
    if (litEnd !== undefined) {
      return { token: "literal", next: litEnd };
    }
  }
  const word = /^@?[A-Za-z_]\w*/u.exec(source.slice(index))?.[0];
  if (word !== undefined) {
    return { token: word, next: index + word.length };
  }
  const compound = COMPOUND_EQ_REGEX.exec(source.slice(index))?.[0];
  if (compound !== undefined) {
    return { token: "op", next: index + compound.length };
  }
  return {
    token: SINGLE_DELIMITERS.includes(ch) ? ch : "other",
    next: index + 1,
  };
}

function isIgnorableHorizontalSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\u{FEFF}";
}

function consumePreprocessorDirective(
  source: string,
  index: number,
): number | undefined {
  const nl = source.indexOf("\n", index);
  const end = nl === -1 ? source.length : nl + 1;
  return /^#(?:nullable|region|endregion)\b/u.test(
    source.slice(index, end).trim(),
  )
    ? end
    : undefined;
}

function tokenizeCSharp(source: string): string[] | undefined {
  const tokens: string[] = [];
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const ch = source[index] ?? "";
    if (isIgnorableHorizontalSpace(ch)) {
      index++;
      continue;
    }
    if (ch === "\n") {
      lineStart = true;
      index++;
      continue;
    }
    if (lineStart && ch === "#") {
      const end = consumePreprocessorDirective(source, index);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      continue;
    }
    lineStart = false;
    const step = tokenizeNext(source, index);
    if (step === undefined) {
      return undefined;
    }
    if (step.token !== undefined) {
      tokens.push(step.token);
    }
    index = step.next;
  }
  return tokens;
}

function groupTokens(tokens: readonly string[]): SyntaxNode[] | undefined {
  const stack: {
    kind: "brace" | "paren" | "bracket";
    close: string;
    children: SyntaxNode[];
  }[] = [];
  const root: SyntaxNode[] = [];
  const openMap: Readonly<
    Record<string, { kind: "brace" | "paren" | "bracket"; close: string }>
  > = {
    "{": { kind: "brace", close: "}" },
    "(": { kind: "paren", close: ")" },
    "[": { kind: "bracket", close: "]" },
  };
  for (const token of tokens) {
    const open = openMap[token];
    if (open !== undefined) {
      stack.push({ kind: open.kind, close: open.close, children: [] });
      continue;
    }
    if (token === "}" || token === ")" || token === "]") {
      const top = stack.pop();
      if (top?.close !== token) {
        return undefined;
      }
      (stack.at(-1)?.children ?? root).push({
        kind: top.kind,
        children: top.children,
      });
      continue;
    }
    (stack.at(-1)?.children ?? root).push({ kind: "atom", value: token });
  }
  return stack.length === 0 ? root : undefined;
}

function splitItems(nodes: readonly SyntaxNode[]): SyntaxNode[][] {
  const items: SyntaxNode[][] = [];
  let current: SyntaxNode[] = [];
  for (const node of nodes) {
    current.push(node);
    if ((node.kind === "atom" && node.value === ";") || node.kind === "brace") {
      items.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    items.push(current);
  }
  return items;
}

function stripAttrsAndModifiers(
  nodes: readonly SyntaxNode[],
  allowed: ReadonlySet<string>,
): {
  readonly withoutAttrs: SyntaxNode[];
  readonly modifiers: Set<string>;
  readonly rest: SyntaxNode[];
} {
  let attrIdx = 0;
  while (nodes[attrIdx]?.kind === "bracket") {
    attrIdx++;
  }
  const withoutAttrs = nodes.slice(attrIdx);
  const modifiers = new Set<string>();
  let modIdx = 0;
  while (modIdx < withoutAttrs.length) {
    const node = withoutAttrs[modIdx];
    if (node?.kind !== "atom" || !allowed.has(node.value)) {
      break;
    }
    modifiers.add(node.value);
    modIdx++;
  }
  return { withoutAttrs, modifiers, rest: withoutAttrs.slice(modIdx) };
}

const hasAtom = (nodes: readonly SyntaxNode[], value: string): boolean =>
  nodes.some((node) => node.kind === "atom" && node.value === value);
const hasKind = (
  nodes: readonly SyntaxNode[],
  kind: "brace" | "paren" | "bracket",
): boolean => nodes.some((node) => node.kind === kind);

function isAssemblyAttributeList(nodes: readonly SyntaxNode[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every((node) => {
      if (node.kind !== "bracket") {
        return false;
      }
      const [target, colon] = node.children;
      return (
        target?.kind === "atom" &&
        (target.value === "assembly" || target.value === "module") &&
        colon?.kind === "atom" &&
        colon.value === ":"
      );
    })
  );
}

function isAccessorDeclarationsOnly(nodes: readonly SyntaxNode[]): boolean {
  const items = splitItems(nodes);
  return (
    items.length > 0 &&
    items.every((item) => {
      const { rest } = stripAttrsAndModifiers(item, ACCESSOR_MODIFIERS);
      return (
        rest.length === 2 &&
        rest[0]?.kind === "atom" &&
        ACCESSOR_NAMES.has(rest[0].value) &&
        rest[1]?.kind === "atom" &&
        rest[1].value === ";"
      );
    })
  );
}

function isValidTypeDeclaration(
  modifiers: ReadonlySet<string>,
  rest: readonly SyntaxNode[],
): boolean {
  const keyword = rest[0];
  const last = rest.at(-1);
  if (last === undefined || keyword?.kind !== "atom") {
    return false;
  }
  if (keyword.value === "delegate") {
    return (
      last.kind === "atom" &&
      last.value === ";" &&
      hasKind(rest, "paren") &&
      !hasAtom(rest, "=")
    );
  }
  const header = rest.slice(1, -1);
  if (
    last.kind !== "brace" ||
    header.length === 0 ||
    hasKind(header, "paren") ||
    hasAtom(header, "=")
  ) {
    return false;
  }
  if (keyword.value === "enum") {
    return true;
  }
  if (keyword.value === "interface") {
    return splitItems(last.children).every((item) =>
      isValidInterfaceMember(item),
    );
  }
  if (keyword.value === "class" && !modifiers.has("record")) {
    const items = splitItems(last.children);
    return items.length > 0 && items.every((item) => isValidClassMember(item));
  }
  return false;
}

function isNestedTypeKeyword(node: SyntaxNode | undefined): boolean {
  return (
    node?.kind === "atom" &&
    (node.value === "enum" ||
      node.value === "delegate" ||
      node.value === "interface" ||
      node.value === "class")
  );
}

function isConstField(
  modifiers: ReadonlySet<string>,
  rest: readonly SyntaxNode[],
): boolean {
  const last = rest.at(-1);
  return (
    modifiers.has("const") &&
    last?.kind === "atom" &&
    last.value === ";" &&
    !hasKind(rest, "paren") &&
    !hasKind(rest, "brace")
  );
}

function isValidInterfaceMember(item: readonly SyntaxNode[]): boolean {
  if (item.length === 1 && item[0]?.kind === "atom" && item[0].value === ";") {
    return true;
  }
  const { modifiers, rest } = stripAttrsAndModifiers(item, MEMBER_MODIFIERS);
  if (isNestedTypeKeyword(rest[0])) {
    return isValidTypeDeclaration(modifiers, rest);
  }
  if (modifiers.has("const")) {
    return isConstField(modifiers, rest);
  }
  if (modifiers.has("static") && !modifiers.has("abstract")) {
    return false;
  }
  const last = rest.at(-1);
  if (last?.kind === "atom" && last.value === ";") {
    return (
      !hasAtom(rest, "=") &&
      (hasAtom(rest, "event")
        ? !hasKind(rest, "paren")
        : hasKind(rest, "paren"))
    );
  }
  const header = rest.slice(0, -1);
  return (
    last?.kind === "brace" &&
    header.length >= 2 &&
    !hasAtom(header, "event") &&
    !hasAtom(header, "=") &&
    !hasKind(header, "paren") &&
    isAccessorDeclarationsOnly(last.children)
  );
}

function isValidClassMember(item: readonly SyntaxNode[]): boolean {
  const { modifiers, rest } = stripAttrsAndModifiers(item, MEMBER_MODIFIERS);
  if (isNestedTypeKeyword(rest[0])) {
    return isValidTypeDeclaration(modifiers, rest);
  }
  return modifiers.has("const")
    ? isConstField(modifiers, rest)
    : modifiers.has("abstract") &&
        !modifiers.has("static") &&
        isValidInterfaceMember(item);
}

function isDirective(nodes: readonly SyntaxNode[]): boolean {
  const last = nodes.at(-1);
  if (last?.kind !== "atom" || last.value !== ";") {
    return false;
  }
  const [first, second] = nodes;
  return (
    (first?.kind === "atom" && first.value === "using") ||
    (first?.kind === "atom" &&
      first.value === "global" &&
      second?.kind === "atom" &&
      second.value === "using") ||
    (first?.kind === "atom" &&
      first.value === "extern" &&
      second?.kind === "atom" &&
      second.value === "alias")
  );
}

function validateNamespaceDeclaration(
  item: readonly SyntaxNode[],
  allowTopLevel: boolean,
): { readonly valid: boolean; readonly declarations: number } {
  const last = item.at(-1);
  if (allowTopLevel && last?.kind === "atom" && last.value === ";") {
    return { valid: true, declarations: 0 };
  }
  return last?.kind === "brace"
    ? validateContainerItems(last.children, false)
    : { valid: false, declarations: 0 };
}

function validateContainerItems(
  nodes: readonly SyntaxNode[],
  allowTopLevel: boolean,
): { readonly valid: boolean; readonly declarations: number } {
  let declarations = 0;
  for (const item of splitItems(nodes)) {
    if (allowTopLevel && isAssemblyAttributeList(item)) {
      declarations++;
      continue;
    }
    const { withoutAttrs, modifiers, rest } = stripAttrsAndModifiers(
      item,
      TYPE_MODIFIERS,
    );
    const unattributed = withoutAttrs.length === item.length;
    if (unattributed && isDirective(item)) {
      continue;
    }
    if (
      unattributed &&
      withoutAttrs[0]?.kind === "atom" &&
      withoutAttrs[0].value === "namespace"
    ) {
      const nsResult = validateNamespaceDeclaration(
        withoutAttrs,
        allowTopLevel,
      );
      if (!nsResult.valid) {
        return { valid: false, declarations: 0 };
      }
      declarations += nsResult.declarations;
      continue;
    }
    if (!isValidTypeDeclaration(modifiers, rest)) {
      return { valid: false, declarations: 0 };
    }
    declarations++;
  }
  return { valid: true, declarations };
}

export function isDeclarationOnlyCSharpSource(source: string): boolean {
  const tokens = tokenizeCSharp(source);
  const grouped = tokens === undefined ? undefined : groupTokens(tokens);
  if (grouped === undefined || grouped.length === 0) {
    return false;
  }
  const result = validateContainerItems(grouped, true);
  return result.valid && result.declarations > 0;
}
