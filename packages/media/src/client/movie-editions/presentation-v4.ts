import type { z } from "zod";
import type { MovieAdmissionReasonV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { movieEditionReasons } from "./presentation.ts";

const reasons: Record<z.infer<typeof MovieAdmissionReasonV4Schema>, string> = {
  ...movieEditionReasons,
  runtime_protected:
    "Media ownership must be confirmed before downloads can start.",
  quality_profile_required:
    "Choose a movie quality profile before starting this request.",
  recovery_hold:
    "This edition is protected while its library history is reviewed.",
  acquisition_active: "Media is already working on this edition.",
  request_inactive: "This request is no longer active.",
  choice_activation_required:
    "Your saved edition choice is ready to be started.",
  asset_unavailable: "This edition has no current library file.",
  native_operation_unsettled:
    "An earlier file operation needs to finish before another change.",
};

export function movieAdmissionReasonV4(
  reason: z.infer<typeof MovieAdmissionReasonV4Schema>,
): string {
  return reasons[reason];
}
