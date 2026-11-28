import type { LobbySeat } from "#src/testing/report-lake/champion-lobbies.ts";

/**
 * What the design-audit group builds on Ahri, for the champion page's group
 * build: most of the friends go Malignance, Shadowflame, Rabadon's with
 * Electrocute, Halcyon opens with Lich Bane, and the viewer goes their own way
 * now and then. Each game also buys the starter and boots a real game does, so
 * the core build has to leave them out.
 */

const DORANS_RING = 1056;
const SORCERERS_SHOES = 3020;
const MALIGNANCE_BUILD = [3118, 4645, 3089];
const LICH_BANE_BUILD = [3100, 4645, 3089];
const LUDENS_BUILD = [6655, 3135, 3089];
const ELECTROCUTE = 8112;
const ARCANE_COMET = 8229;
const CONQUEROR = 8010;

type Build = NonNullable<LobbySeat["build"]>;

function build(items: number[], keystone: number): Build {
  return { purchases: [DORANS_RING, SORCERERS_SHOES, ...items], keystone };
}

/** The build of one person's `nth` game on Ahri (counting from zero). */
export function designAuditAhriBuild(who: string, nth: number): Build {
  switch (who) {
    case "viewer":
      return nth % 4 === 3
        ? build(LICH_BANE_BUILD, CONQUEROR)
        : build(MALIGNANCE_BUILD, ELECTROCUTE);
    case "Halcyon":
      return nth === 3
        ? build(MALIGNANCE_BUILD, ELECTROCUTE)
        : build(LICH_BANE_BUILD, ELECTROCUTE);
    case "Quillon":
      return nth === 4
        ? build(LUDENS_BUILD, ARCANE_COMET)
        : build(MALIGNANCE_BUILD, ELECTROCUTE);
    default:
      return build(MALIGNANCE_BUILD, ELECTROCUTE);
  }
}
