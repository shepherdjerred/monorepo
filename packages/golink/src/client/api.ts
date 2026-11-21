import { z } from "zod";
import {
  LinkItemSchema,
  LinksDirectoryResponseSchema,
  type LinkItem,
  type LinksDirectoryResponse,
  type UpsertManualLinkInput,
} from "#shared/contract.ts";

const ApiErrorPayloadSchema = z.object({
  error: z.string(),
});

const DeleteLinkResponseSchema = z.object({
  deleted: z.literal(true),
});

export class GolinkApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GolinkApiError";
    this.status = status;
  }
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const raw: unknown = await response.json();
    const parsed = ApiErrorPayloadSchema.safeParse(raw);
    if (parsed.success && parsed.data.error.trim().length > 0) {
      return parsed.data.error;
    }
  } catch {
    // Non-JSON error bodies fall back to status summary below.
  }
  return `${fallback} (HTTP ${String(response.status)})`;
}

export async function fetchLinksDirectory(
  signal: AbortSignal | null = null,
): Promise<LinksDirectoryResponse> {
  const response = await fetch("/api/links", {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new GolinkApiError(
      await readErrorMessage(response, "Unable to load shortlink directory"),
      response.status,
    );
  }
  const payload: unknown = await response.json();
  return LinksDirectoryResponseSchema.parse(payload);
}

export async function saveManualLink(
  input: UpsertManualLinkInput,
): Promise<LinkItem> {
  const response = await fetch("/api/links", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new GolinkApiError(
      await readErrorMessage(response, "Unable to save shortlink"),
      response.status,
    );
  }
  const payload: unknown = await response.json();
  return LinkItemSchema.parse(payload);
}

export async function deleteManualLink(short: string): Promise<void> {
  const response = await fetch(`/api/links/${encodeURIComponent(short)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new GolinkApiError(
      await readErrorMessage(response, `Unable to delete go/${short}`),
      response.status,
    );
  }
  const payload: unknown = await response.json();
  DeleteLinkResponseSchema.parse(payload);
}
