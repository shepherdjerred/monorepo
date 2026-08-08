import { ApplicationFailure, sleep } from "@temporalio/workflow";
import type { SleepAutomationInput } from "#shared/schemas.ts";
import { SleepAutomationInputSchema } from "#shared/schemas.ts";
import { callServiceUnchecked } from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom" as const;
const BEDROOM_AC = "climate.bedroom" as const;
const MINUTE_MS = 60_000;

const SLEEP_MEDIA = {
  media_content_id: "FV:2/7",
  media_content_type: "favorite_item_id",
};

export const DEFAULT_SLEEP_MUSIC_DURATION_MINUTES = 180;
export const DEFAULT_SLEEP_AC_DURATION_MINUTES = 120;

function validatedDurationMinutes(input: SleepAutomationInput): number {
  const parsedInput = SleepAutomationInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw ApplicationFailure.nonRetryable(
      "Sleep automation duration must be an integer from 1 to 1440 minutes",
      "SleepAutomationDurationError",
    );
  }
  return parsedInput.data.durationMinutes;
}

export async function sleepMusic(input?: SleepAutomationInput): Promise<void> {
  const durationMinutes =
    input === undefined
      ? DEFAULT_SLEEP_MUSIC_DURATION_MINUTES
      : validatedDurationMinutes(input);

  await callServiceUnchecked("media_player", "unjoin", {
    entity_id: BEDROOM_MEDIA,
  });
  await callServiceUnchecked("media_player", "volume_set", {
    entity_id: BEDROOM_MEDIA,
    volume_level: 0.1,
  });
  await callServiceUnchecked("media_player", "play_media", {
    entity_id: BEDROOM_MEDIA,
    media: SLEEP_MEDIA,
  });

  await sleep(durationMinutes * MINUTE_MS);
  await callServiceUnchecked("media_player", "media_stop", {
    entity_id: BEDROOM_MEDIA,
  });
}

export async function sleepAc(input?: SleepAutomationInput): Promise<void> {
  const durationMinutes =
    input === undefined
      ? DEFAULT_SLEEP_AC_DURATION_MINUTES
      : validatedDurationMinutes(input);

  await callServiceUnchecked("climate", "set_temperature", {
    entity_id: BEDROOM_AC,
    temperature: 24,
    hvac_mode: "cool",
  });

  await sleep(durationMinutes * MINUTE_MS);
  await callServiceUnchecked("climate", "turn_off", {
    entity_id: BEDROOM_AC,
  });
}
