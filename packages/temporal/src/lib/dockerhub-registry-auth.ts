import { z } from "zod";

const ConfigSchema = z.object({
  auths: z.record(z.string(), z.object({ auth: z.string().min(1) })),
});

/** The namespace reader Secret uses Docker's standard base64 auth field. */
export function dockerHubTokenHeaders(
  registryUrl: string,
  tokenUrl: URL,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const registry = new URL(registryUrl);
  if (
    registry.origin !== "https://registry-1.docker.io" ||
    !registry.pathname.startsWith("/v2/shepherdjerred/") ||
    tokenUrl.origin !== "https://auth.docker.io" ||
    tokenUrl.pathname !== "/token" ||
    tokenUrl.searchParams.get("service") !== "registry.docker.io" ||
    tokenUrl.searchParams.get("scope") !==
      `repository:${registry.pathname.split("/").slice(2, 4).join("/")}:pull`
  )
    return {};
  try {
    const config = ConfigSchema.parse(
      JSON.parse(environment["DOCKERHUB_READ_CONFIG_JSON"] ?? ""),
    );
    const auth = config.auths["https://index.docker.io/v1/"]?.auth;
    if (auth === undefined) throw new Error("Missing auth");
    const bytes = Buffer.from(auth, "base64");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      bytes.toString("base64") !== auth ||
      !decoded.startsWith("shepherdjerred:") ||
      decoded.length <= "shepherdjerred:".length
    )
      throw new Error("Invalid auth");
    return { Authorization: `Basic ${auth}` };
  } catch {
    // Parser diagnostics can include credential input.
    throw new Error("Docker Hub reader credentials are missing or invalid");
  }
}
