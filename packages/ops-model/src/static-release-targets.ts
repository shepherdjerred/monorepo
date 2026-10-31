/**
 * Reviewed bucket ownership: the Delivery environment each bucket releases
 * through. Selected archive versions remain in PostgreSQL. An independent site
 * is its own service, `<bucket>/prod`; Scout's frontends ride Scout's
 * environments.
 */
export const STATIC_SITE_DESTINATIONS: Readonly<Record<string, string>> = {
  "statically-typed": "statically-typed/prod",
  "sjer-red": "sjer-red/prod",
  webring: "webring/prod",
  resume: "resume/prod",
  "scout-frontend": "scout-for-lol/prod",
  "scout-frontend-beta": "scout-for-lol/beta",
  "scout-design-system": "scout-design-system/prod",
  "better-skill-capped": "better-skill-capped/prod",
  "ts-mc-docs": "ts-mc-docs/prod",
  "glitter-boys": "glitter-boys/prod",
  "glitter-boys-ppl": "glitter-boys-ppl/prod",
  cook: "cook/prod",
  "cross-compilers": "cross-compilers/prod",
  "stocks-sjer-red": "stocks-sjer-red/prod",
  "landing-pages": "landing-pages/prod",
  "wiki-sjer-red": "wiki-sjer-red/prod",
};

/**
 * The v1 environment ids the running v1 Delivery and its producers use until
 * the window's catalog flip (`woodpecker-delivery-catalog-v2-enabled`). WP4
 * deletes this map with the v1 producer path.
 */
export const V1_STATIC_SITE_DESTINATIONS: Readonly<Record<string, string>> = {
  "statically-typed": "static-sites/statically-typed",
  "sjer-red": "static-sites/sjer-red",
  webring: "static-sites/webring",
  resume: "static-sites/resume",
  "scout-frontend": "scout-for-lol/prod",
  "scout-frontend-beta": "scout-for-lol/beta",
  "scout-design-system": "static-sites/scout-design-system",
  "better-skill-capped": "static-sites/better-skill-capped",
  "ts-mc-docs": "static-sites/ts-mc-docs",
  "glitter-boys": "static-sites/glitter-boys",
  "glitter-boys-ppl": "static-sites/glitter-boys-ppl",
  cook: "static-sites/cook",
  "cross-compilers": "static-sites/cross-compilers",
  "stocks-sjer-red": "static-sites/stocks-sjer-red",
  "wiki-sjer-red": "static-sites/wiki-sjer-red",
};
