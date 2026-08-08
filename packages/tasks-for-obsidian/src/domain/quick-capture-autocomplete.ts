import { projectInputToken } from "../lib/nlp";
import { projectOptionLabel, type ProjectOption } from "./project-options";

export type CaptureSuggestion = {
  readonly key: string;
  readonly token: string;
  readonly label: string;
};

const MAX_SUGGESTIONS = 5;

export function buildCaptureSuggestions(
  value: string,
  projects: readonly ProjectOption[],
  contexts: readonly string[],
  tags: readonly string[],
): readonly CaptureSuggestion[] {
  const lastToken = trailingToken(value)?.text ?? "";
  const makeTokenSuggestions = (
    prefix: string,
    names: readonly string[],
    typed: string,
  ): readonly CaptureSuggestion[] => {
    const lower = typed.toLowerCase();
    return names
      .filter(
        (name) =>
          !name.includes(" ") &&
          name.toLowerCase().startsWith(lower) &&
          name.toLowerCase() !== lower,
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((name) => ({
        key: `${prefix}${name}`,
        token: `${prefix}${name}`,
        label: `${prefix}${name}`,
      }));
  };

  if (lastToken.startsWith("p:") && lastToken.length > 2) {
    const typed = lastToken.slice(2).toLowerCase();
    return projects
      .filter(
        (project) =>
          (project.label.toLowerCase().startsWith(typed) ||
            project.path.toLowerCase().startsWith(typed)) &&
          project.identity.toLowerCase() !== typed,
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((project) => ({
        key: `project:${project.identity}`,
        token: projectInputToken(project.identity),
        label: `p:${projectOptionLabel(project, projects)}`,
      }));
  }
  if (lastToken.startsWith("@") && lastToken.length > 1) {
    return makeTokenSuggestions("@", contexts, lastToken.slice(1));
  }
  if (lastToken.startsWith("#") && lastToken.length > 1) {
    return makeTokenSuggestions("#", tags, lastToken.slice(1));
  }
  return [];
}

export function applyCaptureSuggestion(
  value: string,
  suggestion: CaptureSuggestion,
): string {
  const lastToken = trailingToken(value);
  if (lastToken === undefined) return `${suggestion.token} `;
  return `${value.slice(0, lastToken.start)}${suggestion.token} `;
}

function trailingToken(
  input: string,
): { readonly text: string; readonly start: number } | undefined {
  const match = /\S+$/.exec(input);
  if (match === null) return undefined;
  return { text: match[0], start: match.index };
}
