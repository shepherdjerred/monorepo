#!/usr/bin/env bun

import { currentRelationships, people } from "@shepherdjerred/glitter-context";

const packageRoot = new URL("..", import.meta.url);
const publicRoot = new URL("public/", packageRoot);
const distRoot = new URL("dist/", packageRoot);

const graphPeople = people.filter((person) =>
  currentRelationships.some(
    (relationship) =>
      relationship.sourceId === person.id ||
      relationship.targetId === person.id,
  ),
);
const contextScript = `globalThis.GLITTER_CONTEXT = Object.freeze(${JSON.stringify(
  {
    people: graphPeople,
    relationships: currentRelationships,
  },
)});
`;

await Bun.write(
  new URL("index.html", distRoot),
  await Bun.file(new URL("index.html", publicRoot)).text(),
);
await Bun.write(new URL("context-data.js", distRoot), contextScript);
