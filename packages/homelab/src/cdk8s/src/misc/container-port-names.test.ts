import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { expect, test } from "vitest";
import { z } from "zod";

// Kubernetes IsValidPortName: at most 15 lowercase alphanumeric/hyphen
// characters, at least one letter, no boundary or consecutive hyphens.
const PortNameSchema = z
  .string()
  .max(15)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .regex(/[a-z]/);

const ContainerPortSchema = z.object({
  containerPort: z.number().int().min(1).max(65_535),
  name: z.string().optional(),
});

function* containerPorts(
  value: unknown,
  path: string,
): Generator<{ value: unknown; path: string }> {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      yield* containerPorts(child, `${path}[${index.toString()}]`);
    }
  } else if (value !== null && typeof value === "object") {
    const record = z.record(z.string(), z.unknown()).parse(value);
    if (Object.hasOwn(record, "containerPort")) yield { value: record, path };
    for (const [key, child] of Object.entries(record)) {
      yield* containerPorts(child, `${path}.${key}`);
    }
  }
}

test("all built container port names satisfy the API server contract", async () => {
  const directory = fileURLToPath(new URL("../../dist/", import.meta.url));
  let files = 0;
  let ports = 0;
  for await (const file of new Bun.Glob("*.k8s.yaml").scan({
    cwd: directory,
  })) {
    files += 1;
    const documents = parseAllDocuments(
      await Bun.file(`${directory}/${file}`).text(),
    );
    for (const [index, document] of documents.entries()) {
      // Walking the whole resource covers Pod templates, init containers,
      // operator overrides, and sidecars embedded in external Helm values.
      for (const entry of containerPorts(
        document.toJSON(),
        `${file}[${index.toString()}]`,
      )) {
        ports += 1;
        const port = ContainerPortSchema.parse(entry.value);
        if (port.name === undefined || port.name === "") continue;
        expect(
          PortNameSchema.safeParse(port.name).success,
          `${entry.path}: invalid container port name ${port.name}`,
        ).toBe(true);
      }
    }
  }
  expect(files).toBeGreaterThan(0);
  expect(ports).toBeGreaterThan(0);
});

test.each(["authenticated-ui", "authenticated-web"])(
  "rejects the deployment-blocking port name %s",
  (name) => {
    expect(PortNameSchema.safeParse(name).success).toBe(false);
  },
);
