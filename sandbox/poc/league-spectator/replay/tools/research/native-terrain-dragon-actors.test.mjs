import assert from "node:assert/strict";
import { test } from "node:test";
import { selectReviewedDragonActors } from "./native-terrain-dragon-actors.mjs";

const characters = ["sru_dragon_fire", "sru_dragon_earth", "sru_dragon_chemtech"];
const skins = new Set(characters);
const subject = (character, context) => ({
  subjectContext: context,
  creation: {
    character,
    timeSeconds: 10,
    objectName: `${character}.6.1`,
    payloadSha256: "creation",
  },
  killTimeSeconds: 20,
  observations: [9, 10, 15, 20, 21].map((timeSeconds) => ({ timeSeconds })),
});

test("binds every reviewed dragon context to its authored variant and in-life records", () => {
  const subjects = [...characters, characters[0]].map((character, index) =>
    subject(character, index + 1),
  );
  const actors = selectReviewedDragonActors(subjects, skins);
  assert.equal(actors.length, subjects.length);
  for (const [index, { creation, subjectContext, observations }] of subjects.entries()) {
    assert.deepEqual(actors[index], {
      context: subjectContext,
      modelId: creation.character,
      creationTimeSeconds: 10,
      creationPayloadSha256: creation.payloadSha256,
      objectName: creation.objectName,
      killTimeSeconds: 20,
      observations: observations.slice(1, 3),
    });
  }
});

test("requires named creation and a waypoint before defeat for each corroborated dragon", () => {
  const fire = subject("sru_dragon_fire", 1);
  const earth = subject("sru_dragon_earth", 2);
  for (const unverified of [
    { ...earth, creation: undefined },
    subject("sru_dragon_air", 2),
    { ...earth, subjectContext: fire.subjectContext },
  ]) {
    assert.throws(
      () => selectReviewedDragonActors([fire, unverified], skins),
      /Missing or repeated reviewed dragon creation/,
    );
  }
  assert.throws(
    () =>
      selectReviewedDragonActors(
        [fire, { ...earth, observations: [{ timeSeconds: 20 }] }],
        skins,
      ),
    /Missing in-life dragon waypoints/,
  );
});
