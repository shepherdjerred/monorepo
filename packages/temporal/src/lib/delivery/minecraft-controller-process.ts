import { createHash } from "node:crypto";
import { constants, mkdir, lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { MinecraftPreservationResultSchema } from "./minecraft.ts";
import { sourceJournalFingerprint } from "./minecraft-controller-journal.ts";
import {
  MinecraftRecoveryReportEnvelopeSchema,
  parseMinecraftRecoveryReport,
} from "@shepherdjerred/delivery/contract";
import {
  MinecraftControllerReceiptSchema,
  type MinecraftControllerReceipt,
} from "./minecraft-controller.ts";

export const MinecraftControllerInputSchema = z
  .object({
    requestId: z.uuid(),
    deploymentId: z.string().min(1),
    versionSetRevisionId: z.string().min(1),
    toolingRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    candidateImage: z
      .string()
      .regex(
        /^docker\.io\/shepherdjerred\/the-storm-server:[\w.-]+@sha256:[a-f0-9]{64}$/u,
      ),
    runtimeDigests: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/u)),
  })
  .strict();
export type MinecraftControllerInput = z.infer<
  typeof MinecraftControllerInputSchema
>;
export type MinecraftControllerIdentity = Pick<
  MinecraftControllerReceipt,
  "namespace" | "name" | "uid"
>;
type Command = "eligibility" | "snapshot" | "verify" | "recover" | "report";
export type MinecraftProcess = (
  arguments_: string[],
  environment: Record<string, string | undefined>,
) => Promise<string>;
const Metadata = z
  .object({
    input: MinecraftControllerInputSchema,
    fingerprint: z.string(),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    receipts: z.array(MinecraftControllerReceiptSchema),
  })
  .strict();

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error(
      "Minecraft controller requires an executor-owned private journal directory",
    );
}
async function durableJson(file: string, input: unknown): Promise<void> {
  const temporary = `${file}.writing`;
  const descriptor = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  // File and parent-directory fsync are required for the external-effect journal's crash boundary.
  try {
    await descriptor.writeFile(JSON.stringify(input));
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await rename(temporary, file);
  const directory = await open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function existingMetadata(file: string) {
  try {
    const metadata = await lstat(file);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 1_000_000
    )
      throw new Error(
        "Durable controller identity file is not private and bounded",
      );
    return Metadata.parse(await Bun.file(file).json());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}

/** This transport is closed to reviewed Python operations; no caller-supplied shell or kubectl arguments. */
export class MinecraftControllerProcess {
  constructor(
    private readonly options: {
      journalRoot: string;
      producerRoot: string;
      identity: () => Promise<MinecraftControllerIdentity>;
      process: MinecraftProcess;
    },
  ) {}
  private async workspace(input: MinecraftControllerInput): Promise<string> {
    MinecraftControllerInputSchema.parse(input);
    const requests = path.join(this.options.journalRoot, "requests");
    await privateDirectory(requests);
    const directory = path.join(requests, input.requestId);
    await privateDirectory(directory);
    return directory;
  }
  async prepare(
    input: MinecraftControllerInput,
    recovery = false,
  ): Promise<MinecraftControllerReceipt> {
    const directory = await this.workspace(input);
    const fingerprint = createHash("sha256")
      .update(canonicalJson(input))
      .digest("hex");
    const file = path.join(directory, "operation.json");
    const prior = await existingMetadata(file);
    if (
      prior !== undefined &&
      (prior.fingerprint !== fingerprint ||
        canonicalJson(prior.input) !== canonicalJson(input))
    )
      throw new Error(
        "Durable Minecraft request selected different immutable inputs or tooling",
      );
    const journal = path.join(directory, "world.json");
    // A recorded native identity may never silently reconstruct lost source
    // evidence from a later healthy server. Snapshot initialization is read-only.
    if (prior !== undefined || recovery)
      await sourceJournalFingerprint(journal, input);
    z.object({
      status: z.literal("PREPARED_SOURCE"),
      requestId: z.literal(input.requestId),
      journalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
      .strict()
      .parse(await this.run(input, "snapshot"));
    const sourceFingerprint = await sourceJournalFingerprint(journal, input);
    if (prior !== undefined && prior.sourceFingerprint !== sourceFingerprint)
      throw new Error(
        "Original Minecraft source snapshot changed after native identity was recorded",
      );
    const receipt = MinecraftControllerReceiptSchema.parse({
      ...(await this.options.identity()),
      requestId: input.requestId,
      specFingerprint: fingerprint,
      sourceFingerprint,
    });
    const receipts = prior?.receipts ?? [];
    if (!receipts.some((entry) => entry.uid === receipt.uid))
      receipts.push(receipt);
    await durableJson(file, {
      input,
      fingerprint,
      sourceFingerprint,
      receipts,
    });
    return receipt;
  }
  async run(
    input: MinecraftControllerInput,
    command: Command,
  ): Promise<unknown> {
    const directory = await this.workspace(input);
    if (command !== "eligibility" && command !== "snapshot") {
      const persisted = Metadata.parse(
        await Bun.file(path.join(directory, "operation.json")).json(),
      );
      if (canonicalJson(persisted.input) !== canonicalJson(input))
        throw new Error(
          "Minecraft effects require the exact prepared immutable request",
        );
    }
    const home = path.join(this.options.journalRoot, "home"),
      bootstrap = path.join(this.options.journalRoot, "bootstrap");
    await privateDirectory(home);
    await privateDirectory(bootstrap);
    await privateDirectory(path.join(directory, "tmp"));
    const config = path.join(bootstrap, "kubeconfig.json");
    // File references only: the projected token is never read, copied, logged or returned.
    await durableJson(config, {
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        {
          name: "delivery",
          cluster: {
            server: "https://kubernetes.default.svc",
            "certificate-authority":
              "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
          },
        },
      ],
      users: [
        {
          name: "controller",
          user: {
            tokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
          },
        },
      ],
      contexts: [
        {
          name: "delivery-tsmc-validation",
          context: {
            cluster: "delivery",
            user: "controller",
            namespace: "minecraft-tsmc",
          },
        },
      ],
      "current-context": "delivery-tsmc-validation",
    });
    const arguments_ = [
      "python3",
      path.join(this.options.producerRoot, "delivery_validation.py"),
      command,
      "--context",
      "delivery-tsmc-validation",
      "--request",
      input.requestId,
      "--image",
      input.candidateImage,
    ];
    if (command !== "eligibility")
      arguments_.push(
        "--journal",
        path.join(directory, "world.json"),
        "--receipt",
        path.join(directory, "receipt.json"),
        ...input.runtimeDigests.flatMap((digest) => [
          "--runtime-digest",
          digest,
        ]),
      );
    const output = await this.options.process(arguments_, {
      PATH: Bun.env["PATH"],
      HOME: home,
      TMPDIR: path.join(directory, "tmp"),
      KUBECONFIG: config,
    });
    const result: unknown = JSON.parse(output);
    if (command === "report" || command === "recover") {
      parseMinecraftRecoveryReport(result);
      const persisted = Metadata.parse(
        await Bun.file(path.join(directory, "operation.json")).json(),
      );
      const identity = await this.options.identity();
      const controller = persisted.receipts.find(
        (receipt) => receipt.uid === identity.uid,
      );
      if (
        controller?.sourceFingerprint !==
        (await sourceJournalFingerprint(
          path.join(directory, "world.json"),
          input,
        ))
      )
        throw new Error(
          "Recovery report lacks the unchanged original private source snapshot and native controller identity",
        );
      const reportJson = JSON.stringify(result);
      return MinecraftRecoveryReportEnvelopeSchema.parse({
        requestId: input.requestId,
        controller,
        reportJson,
        reportSha256: `sha256:${createHash("sha256").update(reportJson).digest("hex")}`,
      });
    }
    if (command !== "verify") return result;
    const deferred = z
      .object({
        status: z.literal("waiting"),
        reason: z.literal("players-online"),
        originalReopened: z.literal(true),
      })
      .strict()
      .safeParse(result);
    if (deferred.success) return deferred.data;
    const completed = z
      .object({
        status: z.literal("VERIFIED"),
        requestId: z.literal(input.requestId),
        receiptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(result);
    const receiptPath = path.join(directory, "receipt.json"),
      metadata = await lstat(receiptPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 100_000
    )
      throw new Error(
        "Private preservation receipt is not a bounded executor-owned file",
      );
    const receiptJson = await Bun.file(receiptPath).text();
    const digest = createHash("sha256").update(receiptJson).digest("hex");
    if (digest !== completed.receiptSha256)
      throw new Error(
        "Controller receipt bytes differ from native producer completion",
      );
    return MinecraftPreservationResultSchema.parse({
      requestId: input.requestId,
      receiptJson,
      receiptSha256: `sha256:${digest}`,
    });
  }
}
