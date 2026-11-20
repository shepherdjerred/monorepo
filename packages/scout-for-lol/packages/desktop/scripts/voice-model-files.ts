// The files `scout-voice` locates in its model directory, from the shared
// contract, and the directory the packager configs ship as a resource.
import { SCOUT_VOICE_CASCADE } from "../../data/src/scout-client/voice-cascade.schema.ts";

/** Resource directory name; matches `scout_voice::models::MODEL_DIRECTORY_NAME`. */
export const MODEL_DIRECTORY_NAME = "voice-models";

/** Where `fetch-voice-models.ts` assembles the directory, relative to desktop/. */
export const MODEL_STAGING_DIRECTORY = `target/${MODEL_DIRECTORY_NAME}`;

/** Every file name `ModelPaths::locate` reads from the directory. */
export function requiredModelFiles(): string[] {
  const { keywordSpotter: kws, vad, verifier } = SCOUT_VOICE_CASCADE.models;
  return [
    kws.encoder.name,
    kws.decoder.name,
    kws.joiner.name,
    kws.tokens.name,
    kws.bpe.name,
    kws.keywords.name,
    vad.name,
    verifier.manifest,
    verifier.melspectrogram,
    verifier.embedding,
    verifier.classifier,
    verifier.smokePositive,
  ];
}
