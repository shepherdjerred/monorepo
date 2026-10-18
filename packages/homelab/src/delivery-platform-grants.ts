import {
  tofuStackPolicy,
  TofuStackSchema,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  STACK_MANIFEST,
  STATE_CREDENTIALS,
} from "#scripts/tofu/tofu-stack-manifest.ts";

export type DeliveryPlatformGrant = {
  env: string;
  secret: string;
  key: string;
};
/** Only platform Jobs receive these source-owned provider capabilities. */
export const DELIVERY_PLATFORM_ITEMS = {
  "delivery-platform-api": { itemId: "g6xiqdecqhclbc5fiijzj45nrq" },
  "delivery-plan-encryption": { itemId: "ht456xpr7y3p2sbdfx64zvyv3u" },
  "ci-seaweedfs-credentials": { itemId: "eyfsbfkxojth6ymr65l47yyfxy" },
  "ci-tailscale-credentials": { itemId: "eoqdhvwgu7rjfqe6dknexihitu" },
  "ci-github-credentials": { itemId: "34gzcrhwdm34lpadyly3rcsu44" },
  "ci-cloudflare-credentials": { itemId: "djl2blalora2unjogqnsadlokq" },
  "ci-arr-credentials": { itemId: "vkzv5jm2euzb7727x6uxdpwu5y" },
  "openai-tofu-credentials": { itemId: "jkqhgshctzikhed3vwgogtkmuy" },
  "anthropic-tofu-credentials": { itemId: "a3limlclcej76wmf3kftiqex4u" },
  "discord-tofu-credentials": { itemId: "z2tt5eswusadzfsztg4uwr6vay" },
  "cloudflare-tokens-tofu-credentials": {
    itemId: "rzxdklctncniksfcywoypt3fs4",
  },
  "posthog-tofu-credentials": { itemId: "yh3xvqemmr4ic2up5zluo2rkcq" },
  "discord-birmel-credentials": { itemId: "w5c27dzybxor3j6dzl7lub2soe" },
  "discord-starlight-beta-credentials": {
    itemId: "tdxe6cq7ozhv7cesfvnlkl5gh4",
  },
  "discord-starlight-prod-credentials": {
    itemId: "cmp6si6n5syhr4smxew3qfcmfi",
  },
  "discord-scout-beta-credentials": { itemId: "rtu44pohnp5ixdp2njuv5f6t2e" },
  "discord-scout-prod-credentials": { itemId: "pacrc4wfbtct4y3qazkvazop5a" },
  "discord-minecraft-credentials": { itemId: "q37vet77dfggoqbvu4bqle3gje" },
} as const;
type Secret = keyof typeof DELIVERY_PLATFORM_ITEMS;
const providerSecrets: Readonly<Record<string, Secret>> = {
  seaweedfs: "ci-seaweedfs-credentials",
  tailscale: "ci-tailscale-credentials",
  arr: "ci-arr-credentials",
  github: "ci-github-credentials",
  cloudflare: "ci-cloudflare-credentials",
  openai: "openai-tofu-credentials",
  anthropic: "anthropic-tofu-credentials",
  discord: "discord-tofu-credentials",
  "cloudflare-tokens": "cloudflare-tokens-tofu-credentials",
  posthog: "posthog-tofu-credentials",
};
const discord: Readonly<Record<string, Secret>> = {
  DISCORD_BIRMEL_BOT_TOKEN: "discord-birmel-credentials",
  DISCORD_STARLIGHT_BETA_BOT_TOKEN: "discord-starlight-beta-credentials",
  DISCORD_STARLIGHT_PROD_BOT_TOKEN: "discord-starlight-prod-credentials",
  DISCORD_SCOUT_BETA_BOT_TOKEN: "discord-scout-beta-credentials",
  DISCORD_SCOUT_PROD_BOT_TOKEN: "discord-scout-prod-credentials",
  DISCORD_MINECRAFT_BOT_TOKEN: "discord-minecraft-credentials",
};

export function deliveryTofuGrants(rawStack: unknown): DeliveryPlatformGrant[] {
  const stack = TofuStackSchema.parse(rawStack);
  if (!["automatic", "reviewed-plan"].includes(tofuStackPolicy(stack).mode))
    throw new Error("OpenTofu stack has no Delivery provider grant");
  const secret = providerSecrets[stack];
  if (secret === undefined)
    throw new Error("Reviewed OpenTofu stack lacks its exact credential owner");
  const definition = STACK_MANIFEST[stack];
  const grants: DeliveryPlatformGrant[] = [
    ...STATE_CREDENTIALS.map(({ source }) => ({
      env: source,
      secret: "ci-seaweedfs-credentials",
      key: source,
    })),
    ...definition.credentials.map(({ source }) => ({
      env: source,
      secret,
      key: source === "POSTHOG_CLI_API_KEY" ? "POSTHOG_API_KEY" : source,
    })),
    ...Object.values(definition.secretObject?.entries ?? {}).map((source) => {
      const owner = discord[source];
      if (owner === undefined)
        throw new Error(
          "Platform secret object lacks a reviewed original credential owner",
        );
      return { env: source, secret: owner, key: "DISCORD_TOKEN" };
    }),
    {
      env: "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE",
      secret: "delivery-plan-encryption",
      key: "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE",
    },
  ];
  return [...new Map(grants.map((grant) => [grant.env, grant])).values()];
}
