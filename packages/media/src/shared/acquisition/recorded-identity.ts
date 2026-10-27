import { z } from "zod";
import { DefaultAcquisitionIdentitySchema } from "./library-management.ts";
import { MovieAcquisitionIdentitySchema } from "#shared/movie-editions/management/contracts.ts";

/** Read the literal family. Null belongs to historical attempts; corrupt records never select a compatibility path. */
export function recordedAcquisitionIdentity(raw: unknown) {
  return z
    .union([DefaultAcquisitionIdentitySchema, MovieAcquisitionIdentitySchema])
    .nullable()
    .parse(raw);
}
