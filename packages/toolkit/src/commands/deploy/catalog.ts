import {
  FindQualifiedArtifactSchema,
  IdentifierSchema,
} from "@shepherdjerred/delivery/contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import { required, type DeployOptions } from "./common.ts";

export function validateCatalogCommand(
  command: string,
  positionals: string[],
  options: DeployOptions,
) {
  if (!options.machine)
    throw new Error(
      "Artifact lookup/CI qualification requires its explicit scoped --machine credential",
    );
  if (command === "artifact" && options.file === undefined)
    throw new Error("Exact artifact lookup requires --file");
  if (command === "qualify") IdentifierSchema.parse(positionals[0]);
}
export async function runCatalogCommand(
  client: DeliveryClient,
  command: string,
  positionals: string[],
  options: DeployOptions,
) {
  validateCatalogCommand(command, positionals, options);
  if (command === "artifact") {
    const raw: unknown = await Bun.file(required(options.file)).json();
    return {
      result: await client.findQualifiedArtifact(
        FindQualifiedArtifactSchema.parse(raw),
      ),
      exitCode: 0,
    };
  }
  return {
    result: await client.qualifyBuild(IdentifierSchema.parse(positionals[0])),
    exitCode: 0,
  };
}
