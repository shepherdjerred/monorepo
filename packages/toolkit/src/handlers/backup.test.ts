import { expect, test } from "vitest";
import { handleBackupCommand } from "./backup.ts";

test("the operator command rejects missing or malformed targets before accessing credentials", async () => {
  await expect(
    handleBackupCommand("seaweedfs", [
      "replicate-delivery",
      "--artifact",
      "source-1",
    ]),
  ).rejects.toThrow("--service is required");
  await expect(
    handleBackupCommand("seaweedfs", [
      "replicate-delivery",
      "--artifact",
      "source-1",
      "--service",
      "cloudflare-operator",
      "--digest",
      "invalid",
    ]),
  ).rejects.toThrow();
  await expect(
    handleBackupCommand("seaweedfs", ["replicate-delivery", "--unknown"]),
  ).rejects.toThrow();
});
