import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { z } from "zod/v4";
import { PromotionLoginsSchema } from "#activities/promotion/tools.ts";

const Binding = z.strictObject({
  account: z.string().min(1),
  reference: z.string().regex(/^op:\/\/[a-z0-9]+\/[a-z0-9]+$/),
  backend: z.literal("service-account"),
  hosts: z.array(z.string().min(1)).min(1),
  expectedUsername: z.string().optional(),
  fields: z
    .strictObject({
      username: z.string().min(1),
      password: z.string().min(1),
      email: z.string().min(1).optional(),
      otp: z.string().min(1).optional(),
    })
    .optional(),
});
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    bindings: { type: "string" },
    apply: { type: "boolean", default: false },
  },
  allowPositionals: false,
});
if (values.bindings === undefined)
  throw new Error(
    "Usage: enroll-logins.ts --bindings <non-secret bindings.json> [--apply]",
  );
if ((Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] ?? "") === "")
  throw new Error(
    "Run this one-shot credential enrollment through scripts/onepassword/with-service-account.sh",
  );
const bindings = z
  .array(Binding)
  .min(1)
  .parse(await Bun.file(values.bindings).json());
const itemId = "and7gl2qtwxrlc3ksasdlrrd74",
  vaultId = "v64ocnykdqju4ui6j6pua56xw4";

async function op(args: string[], template?: unknown): Promise<unknown> {
  const env = { ...Bun.env };
  if (template !== undefined) {
    // An inherited pipe is an explicit template path, without a plaintext file or argv value.
    const child = spawn(
      "op",
      ["--cache=false", ...args, "--template", "/dev/fd/3"],
      { env, stdio: ["ignore", "pipe", "pipe", "pipe"] },
    );
    const input = child.stdio[3];
    if (input == null || !("end" in input))
      throw new Error("Credential template pipe is unavailable");
    input.end(JSON.stringify(template));
    let output = "";
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.resume();
    const timer = setTimeout(() => child.kill(), 20_000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    clearTimeout(timer);
    if (code !== 0)
      throw new Error(
        "1Password template update failed; no credential values were logged",
      );
    return JSON.parse(output) as unknown;
  }
  const child = Bun.spawn(["op", "--cache=false", ...args], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.stdin.end();
  const timer = setTimeout(() => {
    child.kill();
  }, 20_000);
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0)
    throw new Error(
      `1Password ${args[1] ?? "operation"} failed; no credential values were logged`,
    );
  return JSON.parse(stdout) as unknown;
}
const Item = z.looseObject({
  id: z.string(),
  fields: z.array(
    z.looseObject({
      id: z.string().optional(),
      label: z.string(),
      purpose: z.string().optional(),
      type: z.string().optional(),
      value: z.string().optional(),
    }),
  ),
});
function loginField(
  item: z.infer<typeof Item>,
  purpose: string,
  label?: string,
): string | undefined {
  return item.fields.find((entry) =>
    label === undefined ? entry.purpose === purpose : entry.label === label,
  )?.value;
}
const current = Item.parse(
  await op(["item", "get", itemId, "--vault", vaultId, "--format", "json"]),
);
const field = current.fields.find(
  (entry) => entry.label === "STORM_PROMOTION_LOGINS",
);
if (field?.value === undefined)
  throw new Error("Promotion login field is missing");
const logins = PromotionLoginsSchema.parse(JSON.parse(field.value));
for (const binding of bindings) {
  const locator = binding.reference.split("/");
  const sourceVault = locator[2],
    sourceId = locator[3];
  if (sourceId === undefined || sourceVault === undefined)
    throw new Error("Invalid source locator");
  const source = Item.parse(
    await op([
      "item",
      "get",
      sourceId,
      "--vault",
      sourceVault,
      "--format",
      "json",
    ]),
  );
  const username = loginField(source, "USERNAME", binding.fields?.username);
  const password = loginField(source, "PASSWORD", binding.fields?.password);
  const otp = source.fields.find((entry) =>
    binding.fields?.otp === undefined
      ? entry.type === "OTP"
      : entry.label === binding.fields.otp,
  )?.value;
  const email = source.fields.find((entry) =>
    binding.fields === undefined
      ? entry.label.toLowerCase() === "email"
      : entry.label === binding.fields.email,
  )?.value;
  if (
    username === undefined ||
    password === undefined ||
    username === "" ||
    password === ""
  )
    throw new Error(`Login fields missing for ${binding.account}`);
  if (
    binding.expectedUsername !== undefined &&
    username !== binding.expectedUsername
  )
    throw new Error(`Source identity mismatch for ${binding.account}`);
  logins[binding.account] = {
    username,
    password,
    hosts: binding.hosts,
    ...(otp === undefined ? {} : { otp }),
    ...(z.email().safeParse(email).success ? { email } : {}),
  };
  print({
    account: binding.account,
    sourceRead: true,
    hostBound: true,
    hasStoredEmail: z.email().safeParse(email).success,
  });
}
if (values.apply) {
  field.value = JSON.stringify(PromotionLoginsSchema.parse(logins));
  const edited = Item.parse(
    await op(
      ["item", "edit", itemId, "--vault", vaultId, "--format", "json"],
      current,
    ),
  );
  if (
    edited.fields.find((entry) => entry.label === "STORM_PROMOTION_LOGINS")
      ?.value !== field.value
  )
    throw new Error("1Password did not accept the intended login field update");
  const saved = Item.parse(
    await op(["item", "get", itemId, "--vault", vaultId, "--format", "json"]),
  );
  if (
    saved.fields.find((entry) => entry.label === "STORM_PROMOTION_LOGINS")
      ?.value !== field.value
  )
    throw new Error("Credential handoff readback did not match");
  print({
    saved: true,
    verifiedReadback: true,
    accounts: bindings.map((binding) => binding.account),
  });
} else print({ saved: false, validatedBindings: bindings.length });

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
