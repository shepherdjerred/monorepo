import { dockerHubLogin } from "./dockerhub-env.ts";

if (import.meta.main) {
  await dockerHubLogin("publisher", Bun.env);
}
