import { z } from "zod";

/** Enable the server-scoped Stargate flag only in disposable acceptance servers. */
export function stargatesEvaluation(
  body: unknown,
  request: Request,
): Response | undefined {
  const evaluation = z
    .strictObject({
      namespace_key: z.literal("the-storm"),
      flag_key: z.literal("the-storm-stargates-enabled"),
      entity_id: z.literal("the-storm-server"),
      context: z.strictObject({}),
    })
    .safeParse(body);
  return evaluation.success &&
    request.headers.get("x-flipt-environment") === "prod"
    ? Response.json({ enabled: true })
    : undefined;
}

/** Per-player expansion flags in the disposable Flipt double. */
export function expansionEvaluation(
  body: unknown,
  request: Request,
  screeningEnabled: boolean,
): Response | undefined {
  const expansion = z
    .strictObject({
      namespace_key: z.literal("the-storm"),
      flag_key: z.enum([
        "the-storm-staff-tools-enabled",
        "the-storm-identity-enabled",
        "the-storm-letters-enabled",
        "the-storm-ip-enforcement-enabled",
        "the-storm-analytics-enabled",
        "the-storm-content-safety-enabled",
        "the-storm-anticheat-corrections-enabled",
      ]),
      entity_id: z.uuid(),
      context: z.strictObject({}),
    })
    .safeParse(body);
  return expansion.success &&
    request.headers.get("x-flipt-environment") === "prod"
    ? Response.json({
        enabled:
          ![
            "the-storm-ip-enforcement-enabled",
            "the-storm-anticheat-corrections-enabled",
          ].includes(expansion.data.flag_key) &&
          (screeningEnabled ||
            expansion.data.flag_key !== "the-storm-content-safety-enabled"),
      })
    : undefined;
}
