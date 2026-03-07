import { StreamLanguage } from "@codemirror/language";

type CookState = {
  inFrontmatter: boolean;
  frontmatterDone: boolean;
  lineStart: boolean;
};

/** StreamLanguage definition for Cooklang syntax highlighting in CodeMirror 6. */
export const cookLanguage = StreamLanguage.define<CookState>({
  startState(): CookState {
    return { inFrontmatter: false, frontmatterDone: false, lineStart: true };
  },

  token(stream, state): string | null {
    if (stream.sol()) {
      state.lineStart = true;
    }

    // Frontmatter delimiter
    if (state.lineStart && stream.match(/^---\s*$/)) {
      if (!state.frontmatterDone) {
        state.inFrontmatter = !state.inFrontmatter;
        if (!state.inFrontmatter) state.frontmatterDone = true;
      }
      state.lineStart = false;
      return "meta";
    }

    // Inside frontmatter
    if (state.inFrontmatter) {
      if (state.lineStart && stream.match(/^[\w.-]+:/)) {
        state.lineStart = false;
        return "atom";
      }
      stream.next();
      state.lineStart = false;
      return "string";
    }

    state.lineStart = false;

    // Section header: = Name or == Name ==
    if (stream.sol() && stream.match(/^=+\s*.+/)) {
      return "heading";
    }

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
  },
});
