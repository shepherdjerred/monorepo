import {
  reconcileTailscaleHostnameHandover,
  resolveInClusterCoordinates,
  TailscaleHandoverBootstrapSchema,
} from "#infrastructure/tailscale-handover.ts";

const config = TailscaleHandoverBootstrapSchema.parse(Bun.env);
const cluster = await resolveInClusterCoordinates();
const result = await reconcileTailscaleHostnameHandover({
  config,
  ...cluster,
});

console.warn(
  JSON.stringify({
    message: "golink_tailscale_handover_completed",
    ...result,
  }),
);
