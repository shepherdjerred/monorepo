import { z } from "zod";

const API_BASE = "https://api.obsidian.md";

const ErrorResponseSchema = z.object({
  error: z.string(),
});

const VaultSchema = z.object({
  id: z.string(),
  name: z.string(),
  password: z.string(),
  salt: z.string(),
  created: z.number(),
  host: z.string(),
  size: z.number(),
  limit: z.number().optional(),
  region: z.string().optional(),
  encryption_version: z.number().optional().transform((v) => v ?? 0),
});

const SharedVaultSchema = z.object({
  id: z.string(),
  name: z.string(),
  password: z.string(),
  salt: z.string(),
  host: z.string(),
  size: z.number(),
  limit: z.number().optional(),
  region: z.string().optional(),
  encryption_version: z.number().optional().transform((v) => v ?? 0),
});

const VaultListResponseSchema = z.object({
  vaults: z.array(VaultSchema),
  shared: z.array(SharedVaultSchema),
});

const VaultAccessResponseSchema = z.object({
  host: z.string().optional(),
  token: z.string().optional(),
});

export type Vault = z.output<typeof VaultSchema>;
export type SharedVault = z.output<typeof SharedVaultSchema>;
export type VaultListResponse = z.output<typeof VaultListResponseSchema>;
export type VaultAccessResponse = z.output<typeof VaultAccessResponseSchema>;

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiRequest(
  endpoint: string,
  body: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const json: unknown = await response.json();
  const errorResult = ErrorResponseSchema.safeParse(json);
  if (errorResult.success) {
    throw new ApiError(errorResult.data.error);
  }
  return schema.parse(json) as unknown;
}

export async function listVaults(
  token: string,
): Promise<VaultListResponse> {
  const result = await apiRequest(
    "/vault/list",
    { token, supported_encryption_version: 3 },
    VaultListResponseSchema,
  );
  return VaultListResponseSchema.parse(result);
}

export type VaultAccessParams = {
  token: string;
  vaultUid: string;
  keyhash: string;
  host: string;
  encryptionVersion: number;
};

export async function accessVault(
  params: VaultAccessParams,
): Promise<VaultAccessResponse> {
  const result = await apiRequest(
    "/vault/access",
    {
      token: params.token,
      vault_uid: params.vaultUid,
      keyhash: params.keyhash,
      host: params.host,
      encryption_version: params.encryptionVersion,
    },
    VaultAccessResponseSchema,
  );
  return VaultAccessResponseSchema.parse(result);
}
