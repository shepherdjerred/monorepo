import { z } from "zod";
import contract from "./evidence-contract.json";

const ContractSchema = z.strictObject({
  version: z.literal(1),
  actions: z.array(z.string()),
  maxPageSize: z.number().int().positive(),
  requestFields: z.array(z.string()),
  responseFields: z.array(z.string()),
});
const evidenceContract = ContractSchema.parse(contract);
export const EvidenceQuerySchema = z
  .strictObject({
    action: z.enum(["search", "show", "export"]),
    player: z.string().max(128),
    text: z.string().max(4000),
    surface: z.string().max(64),
    since: z.iso.datetime({ offset: true }),
    until: z.iso.datetime({ offset: true }),
    after: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(evidenceContract.maxPageSize),
    id: z.string().max(36),
  })
  .refine(
    (query) => query.action !== "show" || z.uuid().safeParse(query.id).success,
    "show requires a submission UUID",
  )
  .refine(
    (query) => Date.parse(query.since) <= Date.parse(query.until),
    "Invalid evidence time range",
  );
export const EvidencePageSchema = z.strictObject({
  version: z.literal(1),
  rows: z.array(z.record(z.string(), z.unknown())),
  events: z.array(z.record(z.string(), z.unknown())),
  next: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type EvidenceQuery = z.infer<typeof EvidenceQuerySchema>;
if (
  EvidenceQuerySchema.shape.action.options.join(",") !==
    evidenceContract.actions.join(",") ||
  Object.keys(EvidenceQuerySchema.shape).join(",") !==
    evidenceContract.requestFields.join(",") ||
  Object.keys(EvidencePageSchema.shape).join(",") !==
    evidenceContract.responseFields.join(",")
)
  throw new Error("Evidence schemas differ from shared contract");
