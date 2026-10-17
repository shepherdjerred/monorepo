import { staticSiteDeliveryOwner } from "../../packages/homelab/src/static-site-delivery-ownership.ts";

const bucket = Bun.argv[2];
if (bucket === undefined || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket))
  throw new Error("Explicit static-site bucket required");
console.log(
  staticSiteDeliveryOwner(bucket) === undefined ? "legacy" : "delivery",
);
