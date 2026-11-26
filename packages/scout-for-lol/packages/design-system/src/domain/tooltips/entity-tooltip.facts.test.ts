import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AbilityFactSchema } from "@scout-for-lol/data/game-facts/schema.ts";
import ahriEJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-E.json" with { type: "json" };
import {
  charm,
  charmKeywordPart,
  fixtureFacts,
  generatedFacts,
} from "./entity-tooltip.facts.ts";
import { stalledLoader } from "./entity-tooltip.fixtures.tsx";
import { EntityTooltip } from "./entity-tooltip.tsx";
import { GameFactProvider } from "./game-fact.tsx";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

describe("tooltip story fixtures", () => {
  test("every part a story can open has a fixture to load", () => {
    const known = new Set(
      fixtureFacts.map((fact) => `${fact.kind}/${fact.key}`),
    );
    const missing = fixtureFacts.flatMap((fact) =>
      fact.parts
        .filter((part) => !known.has(`${part.kind}/${part.key}`))
        .map((part) => `${fact.kind}/${fact.key} -> ${part.kind}/${part.key}`),
    );
    expect(missing).toEqual([]);
  });

  test("Charm is the generated ability with only the keyword part added", () => {
    const generated = AbilityFactSchema.parse(ahriEJson);
    expect({ ...charm, parts: generated.parts }).toEqual(generated);
    expect(charm.parts).toEqual([...generated.parts, charmKeywordPart]);
  });

  test.each(generatedFacts.map((fact) => [`${fact.kind}/${fact.key}`, fact]))(
    "%s renders the generated name, key fact and facts, not retyped ones",
    (_id, fact) => {
      // A rune folds its "Type" fact into the header, in lower case.
      const markup = renderToStaticMarkup(
        createElement(GameFactProvider, {
          loader: stalledLoader,
          children: createElement(EntityTooltip, { fact }),
        }),
      ).toLowerCase();
      expect(markup).toContain(escapeHtml(fact.name).toLowerCase());
      for (const entry of fact.facts.slice(0, 3)) {
        expect(markup).toContain(escapeHtml(entry.value).toLowerCase());
      }
      if (fact.kind === "item") {
        expect(markup).toContain(escapeHtml(fact.keyFact.value).toLowerCase());
      }
    },
  );
});
