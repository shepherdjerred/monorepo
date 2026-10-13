import { ActorSchema, type ActorEnvelope } from "#shared/actor.ts";

const key = "tracker.actor.v1";
const sessionId = sessionStorage.getItem("tracker.tab") ?? crypto.randomUUID();
sessionStorage.setItem("tracker.tab", sessionId);

export function currentActor(): ActorEnvelope {
  const saved = localStorage.getItem(key);
  const actor = ActorSchema.parse(
    saved === null
      ? { key: "human:jerred", kind: "human", name: "Jerred" }
      : JSON.parse(saved),
  );
  return {
    ...actor,
    metadata: { ...actor.metadata, harness: "browser", sessionId },
  };
}
export function saveActor(actor: ActorEnvelope) {
  localStorage.setItem(key, JSON.stringify(ActorSchema.parse(actor)));
}
