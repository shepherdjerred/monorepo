/** ArgoCD uses go-shellquote: quotes/escapes, no expansion or shell operators. */
function splitOptions(input: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  const fragments = /[ \n\t]+|'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^ \n\t'"\\]+/gsuy;
  while (fragments.lastIndex < input.length) {
    const match = fragments.exec(input);
    if (match === null)
      throw new Error("toolkit: malformed ARGOCD_OPTS quoting");
    const fragment = match[0];
    if (/^[ \n\t]/u.test(fragment)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (fragment !== "\\\n") {
      word = (word ?? "") + unquoteFragment(fragment);
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

function unquoteFragment(fragment: string): string {
  if (fragment.startsWith("'")) return fragment.slice(1, -1);
  if (fragment.startsWith('"')) {
    return fragment
      .slice(1, -1)
      .replaceAll(/\\([$`"\n\\])/gu, (_match, character: string) =>
        character === "\n" ? "" : character,
      );
  }
  return fragment.startsWith("\\") ? fragment.slice(1) : fragment;
}

export function protectArgoTokenDefault(options: string): string {
  if (
    splitOptions(options).some(
      (word) => word === "--auth-token" || word.startsWith("--auth-token="),
    )
  ) {
    throw new Error(
      "toolkit: ARGOCD_OPTS must not set --auth-token because ArgoCD prints it in help; use ARGOCD_AUTH_TOKEN instead",
    );
  }
  // Empty native flag default; API authentication still reads the environment.
  return `--auth-token "" ${options}`.trimEnd();
}
