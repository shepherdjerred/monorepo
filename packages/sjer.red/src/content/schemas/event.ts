import { z } from "zod";

export const LocationSchema = z.object({
  text: z.string(),
  url: z.string().url(),
  parking: z.string().optional(),
});

export const EventSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.date(),
  cost: z.number().optional(),
  location: LocationSchema.default({
    text: "Jerred's house (345 N 137th St)",
    url: "https://maps.app.goo.gl/VobB9tKBndh3frCB6",
    parking:
      "Don't block in a Subaru (those are Matt & Naomi's, who live downstairs). If there aren't enough spots in the driveway, then you can park along the street.",
  }),
  rsvp: z.boolean().default(false),
});
