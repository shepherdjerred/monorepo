/**
 * Rewrites Grafana template-variable references in a PromQL/LogQL expression so
 * the dashboard-audit script can execute it standalone.
 *
 * Dashboards reference variables from every matcher operator, so a purely
 * textual "$var → .*" substitution is wrong for equality matchers: rewriting
 * `cluster="$cluster"` to `cluster=".*"` matches only the literal string ".*"
 * and turns a healthy panel into a false "no data" finding (which is exactly
 * what happened to every upstream kube-prometheus-stack dashboard). Rewrite
 * the matcher structurally instead:
 *
 * - `label="$var"` / `label=~"$var"` (including `${var}` and `^$var$` anchored
 *   forms) → `label=~".*"`, the audit equivalent of Grafana's "All".
 * - `label!="$var"` / `label!~"$var"` → `label!~"[^\s\S]"`. That regex can
 *   never match anything, so the negative matcher keeps every series.
 * - `$__rate_interval` / `$__interval` / `$interval` / `$resolution` → `5m`,
 *   and `$__range` → `1h`, so range selectors stay parseable.
 * - Any leftover `$var` (only reachable inside a regex value or function
 *   argument) → `.*`.
 */

const LABEL_NAME = String.raw`([a-z_]\w*)`;
// A quoted matcher value that is exactly one variable reference, optionally
// anchored: "$var", "${var}", "^$var$".
const VARIABLE_VALUE = String.raw`"\^?\$\{?[a-z_]\w*\}?\$?"`;
// PromQL-escaped never-matching regex: the character class matches no
// character, and full anchoring means it cannot match the empty string either.
const NEVER_MATCH = String.raw`[^\\s\\S]`;

export function replaceGrafanaVariables(expression: string): string {
  return expression
    .replaceAll(
      new RegExp(String.raw`${LABEL_NAME}\s*=~?\s*${VARIABLE_VALUE}`, "gi"),
      '$1=~".*"',
    )
    .replaceAll(
      new RegExp(
        String.raw`${LABEL_NAME}\s*!(?:=|~)\s*${VARIABLE_VALUE}`,
        "gi",
      ),
      `$1!~"${NEVER_MATCH}"`,
    )
    .replaceAll(
      /\$__rate_interval|\$__interval_ms|\$__interval|\$resolution|\$interval\b/g,
      "5m",
    )
    .replaceAll(/\$__range_s|\$__range_ms|\$__range\b/g, "1h")
    .replaceAll(/\$\{?[a-z_]\w*\}?/gi, ".*");
}
