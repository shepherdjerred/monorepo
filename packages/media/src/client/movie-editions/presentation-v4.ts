import type { z } from "zod";
import type { MovieAdmissionReasonV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { movieEditionReasons } from "./presentation.ts";

const reasons: Record<z.infer<typeof MovieAdmissionReasonV4Schema>, string> = {
  ...movieEditionReasons,
  runtime_protected:
    "Downloads are paused until the owner confirms Media manages this library.",
  quality_profile_required:
    "The owner needs to choose a quality profile for films before this can start.",
  recovery_hold:
    "This version is on hold while the owner reviews the library’s history.",
  acquisition_active: "Media is already working on this version.",
  request_inactive: "This request has ended.",
  choice_activation_required:
    "Your saved choice of version is ready to be started.",
  asset_unavailable: "This version has no file in the library yet.",
  native_operation_unsettled:
    "An earlier change to the files has to finish first.",
};

export function movieAdmissionReasonV4(
  reason: z.infer<typeof MovieAdmissionReasonV4Schema>,
): string {
  return reasons[reason];
}
