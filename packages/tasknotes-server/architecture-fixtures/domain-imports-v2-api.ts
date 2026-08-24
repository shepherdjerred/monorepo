// Deliberate violation of domain-is-pure against the v2 `/api/*` surface
// specifically. `routes/` and `v2/` are both transports, and a rule that named
// only `routes` left the primary API unenforced — this fixture is what keeps
// the `v2` target honest.
import "../src/v2/routes.ts";

export const illegalDomainApiDependency = true;
