/**
 * What Woodpecker's envsubst (drone/envsubst v1.0.3) does to text with no
 * substitutions left: it collapses `$$`, `\\` and `\/` pairwise.
 */
export function substitute(yaml: string): string {
  return yaml.replaceAll(/\$\$|\\[\\/]/gu, (pair) => pair.slice(1));
}
