import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import {
  buildPetCareAlert,
  type PetCareAlertInput,
} from "#shared/alerts/pet-care-alert.ts";

export const petCareAlertActivities = {
  async publishPetCareAlert(input: PetCareAlertInput): Promise<void> {
    const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
    if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
      throw new Error(
        "ALERTMANAGER_URL is required to publish pet-care alerts",
      );
    }
    await createAlertmanagerPoster(alertmanagerUrl)([
      buildPetCareAlert(input, new Date()),
    ]);
  },
};

export type PetCareAlertActivities = typeof petCareAlertActivities;
