export type CookState = {
  inFrontmatter: boolean;
  frontmatterDone: boolean;
  frontmatterValue: boolean;
  inBlockValue: boolean;
  lineStart: boolean;
};

export type CookStream = {
  sol: () => boolean;
  match: (pattern: RegExp) => RegExpMatchArray | null;
  next: () => string | null;
};

export type CookParser = {
  startState: () => CookState;
  token: (stream: CookStream, state: CookState) => string | null;
};

function blockValueToken(stream: CookStream, state: CookState): string | null {
  if (!state.inBlockValue) return null;

  if (state.lineStart && stream.match(/^\s+/)) {
    state.lineStart = false;
    return "docString";
  }

  if (state.lineStart) state.inBlockValue = false;
  if (!state.inBlockValue) return null;

  stream.next();
  return "docString";
}

function delimiterToken(stream: CookStream, state: CookState): string | null {
  if (!state.lineStart || !stream.match(/^---\s*$/)) return null;

  if (!state.frontmatterDone) {
    state.inFrontmatter = !state.inFrontmatter;
    if (!state.inFrontmatter) state.frontmatterDone = true;
  }
  state.lineStart = false;
  state.frontmatterValue = false;
  return "meta";
}

function frontmatterKeyToken(
  stream: CookStream,
  state: CookState,
): string | null {
  if (!state.lineStart || !stream.match(/^[\w.-]+:/)) return null;

  state.lineStart = false;
  state.frontmatterValue = true;
  return "atom";
}

function frontmatterValueToken(stream: CookStream, state: CookState): string {
  if (state.frontmatterValue) {
    if (stream.match(/^\s*[|>][-+]?/)) {
      state.frontmatterValue = false;
      state.inBlockValue = true;
      return "operator";
    }

    if (stream.match(/^\s*https?:\/\/\S+/)) {
      state.frontmatterValue = false;
      return "url";
    }

    state.frontmatterValue = false;
  }

  state.lineStart = false;
  stream.next();
  return "string";
}

function frontmatterToken(stream: CookStream, state: CookState): string | null {
  const blockToken = blockValueToken(stream, state);
  if (blockToken !== null) return blockToken;

  const metadataDelimiter = delimiterToken(stream, state);
  if (metadataDelimiter !== null) return metadataDelimiter;

  if (!state.inFrontmatter) return null;

  const metadataKey = frontmatterKeyToken(stream, state);
  if (metadataKey !== null) return metadataKey;

  return frontmatterValueToken(stream, state);
}

function cooklangToken(stream: CookStream, state: CookState): string | null {
  // Section header: = Name or == Name ==
  if (state.lineStart && stream.match(/^=+\s*.+/)) {
    state.lineStart = false;
    return "heading";
  }

  state.lineStart = false;

  // Comment: -- rest of line
  if (stream.match(/^--.*$/)) {
    return "comment";
  }

  // Ingredient: @name{qty%unit} or @name
  if (stream.match(/@\w[\w\s]*\{[^}]*\}/)) {
    return "variableName";
  }
  if (stream.match(/@\w[\w-]*/)) {
    return "variableName";
  }

  // Cookware: #name{} or #name
  if (stream.match(/#\w[\w\s]*\{[^}]*\}/)) {
    return "keyword";
  }
  if (stream.match(/#\w[\w-]*/)) {
    return "keyword";
  }

  // Timer: ~name{qty%unit} or ~{qty%unit}
  if (stream.match(/~\w*\{[^}]*\}/)) {
    return "number";
  }

  stream.next();
  return null;
}

export const cookParser: CookParser = {
  startState(): CookState {
    return {
      inFrontmatter: false,
      frontmatterDone: false,
      frontmatterValue: false,
      inBlockValue: false,
      lineStart: true,
    };
  },

  token(stream, state): string | null {
    if (stream.sol()) {
      state.lineStart = true;
    }

    const metadataToken = frontmatterToken(stream, state);
    return metadataToken ?? cooklangToken(stream, state);
  },
};
