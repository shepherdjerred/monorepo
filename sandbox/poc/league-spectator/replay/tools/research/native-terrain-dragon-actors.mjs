/** Bind corroborated kills to the original named creation and in-life waypoints. */
export function selectReviewedDragonActors(subjects, skins) {
  if (!subjects.length) throw Error("Saved replay lacks reviewed dragon kills");
  const contexts = new Set();
  return subjects.map(
    ({ subjectContext, creation, killTimeSeconds, observations }) => {
      const character = creation?.character;
      if (!skins.has(character) || contexts.has(subjectContext))
        throw Error(
          `Missing or repeated reviewed dragon creation for ${subjectContext}`,
        );
      contexts.add(subjectContext);
      const inLife = observations.filter(
        ({ timeSeconds }) =>
          timeSeconds >= creation.timeSeconds && timeSeconds < killTimeSeconds,
      );
      if (!inLife.length)
        throw Error(`Missing in-life dragon waypoints for ${subjectContext}`);
      return {
        context: subjectContext,
        modelId: character,
        creationTimeSeconds: creation.timeSeconds,
        creationPayloadSha256: creation.payloadSha256,
        objectName: creation.objectName,
        killTimeSeconds,
        observations: inLife,
      };
    },
  );
}
