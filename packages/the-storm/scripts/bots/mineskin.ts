/**
 * Signed textures from the public MineSkin API v2
 * (https://docs.mineskin.org, spec at https://api.mineskin.org/v2/openapi.json).
 *
 * A skin is queued with `POST /v2/queue` (multipart `file`) and polled at
 * `GET /v2/queue/{jobId}` until it completes. Every response carries a
 * `rateLimit.next.relative` delay that is honoured before the next submission;
 * anonymous use is allowed with a longer delay (6 s and 10 requests a minute at
 * the time of writing). `MINESKIN_API_KEY`, when set, is sent as a bearer token
 * for the shorter authenticated delay.
 */
import { z } from "zod";

const BASE_URL = "https://api.mineskin.org";
const POLL_MS = 2000;
const MAX_WAIT_MS = 180_000;
const MAX_SUBMIT_ATTEMPTS = 5;

const MessageSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

const RateLimitSchema = z
  .object({
    next: z.object({ relative: z.number() }).partial().optional(),
    delay: z.object({ millis: z.number() }).partial().optional(),
  })
  .partial();

const JobSchema = z.object({
  id: z.string(),
  status: z.enum(["unknown", "waiting", "active", "failed", "completed"]),
});

const SkinSchema = z.object({
  uuid: z.string(),
  texture: z.object({
    data: z.object({ value: z.string().min(1), signature: z.string().min(1) }),
    url: z.object({ skin: z.string() }),
  }),
  duplicate: z.boolean().optional(),
});

const ResponseSchema = z
  .object({
    success: z.boolean().optional(),
    errors: z.array(MessageSchema).optional(),
    warnings: z.array(MessageSchema).optional(),
    rateLimit: RateLimitSchema.optional(),
    job: JobSchema.optional(),
    skin: SkinSchema.optional(),
  })
  .loose();

export type SignedTexture = {
  value: string;
  signature: string;
  mineskinUuid: string;
  textureUrl: string;
  duplicate: boolean;
};

export type MineSkinOptions = {
  userAgent: string;
  apiKey: string | undefined;
};

function describe(errors: z.infer<typeof MessageSchema>[] | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.code ?? "error"}: ${error.message ?? ""}`)
    .join("; ");
}

export class MineSkin {
  private nextAllowedAt = 0;

  constructor(private readonly options: MineSkinOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.options.userAgent,
      Accept: "application/json",
    };
    if (this.options.apiKey !== undefined && this.options.apiKey !== "") {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }
    return headers;
  }

  private async parse(
    response: Response,
  ): Promise<z.infer<typeof ResponseSchema>> {
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `mineskin: ${String(response.status)} with a non-JSON body: ${text.slice(0, 200)}`,
      );
    }
    const body = ResponseSchema.parse(json);
    const relative = body.rateLimit?.next?.relative;
    if (relative !== undefined && relative > 0) {
      this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + relative);
    }
    return body;
  }

  private async waitForSlot(): Promise<void> {
    const wait = this.nextAllowedAt - Date.now();
    if (wait > 0) {
      await Bun.sleep(wait);
    }
  }

  /** Queues `png` and waits for its signed texture. */
  async generate(
    png: Uint8Array<ArrayBuffer>,
    name: string,
  ): Promise<SignedTexture> {
    const job = await this.submit(png, name);
    if (job.skin !== undefined) {
      return toTexture(job.skin);
    }
    if (job.job === undefined) {
      throw new Error("mineskin: queue response had neither a job nor a skin");
    }
    return this.await(job.job.id);
  }

  private async submit(
    png: Uint8Array<ArrayBuffer>,
    name: string,
  ): Promise<z.infer<typeof ResponseSchema>> {
    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
      await this.waitForSlot();
      const form = new FormData();
      form.set("file", new Blob([png], { type: "image/png" }), `${name}.png`);
      form.set("variant", "classic");
      form.set("name", name.slice(0, 20));
      form.set("visibility", "public");
      const response = await fetch(`${BASE_URL}/v2/queue`, {
        method: "POST",
        headers: this.headers(),
        body: form,
      });
      const body = await this.parse(response);
      if (response.status === 200 || response.status === 202) {
        return body;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          this.nextAllowedAt = Math.max(
            this.nextAllowedAt,
            Date.now() + retryAfter * 1000,
          );
        } else if (this.nextAllowedAt <= Date.now()) {
          this.nextAllowedAt = Date.now() + 1000 * 2 ** attempt;
        }
        console.error(
          `mineskin: rate limited submitting ${name} (${describe(body.errors)}); waiting`,
        );
        continue;
      }
      if (response.status >= 500) {
        console.error(
          `mineskin: ${String(response.status)} submitting ${name} (${describe(body.errors)}); retrying`,
        );
        this.nextAllowedAt = Math.max(
          this.nextAllowedAt,
          Date.now() + 1000 * 2 ** attempt,
        );
        continue;
      }
      throw new Error(
        `mineskin: ${String(response.status)} submitting ${name}: ${describe(body.errors)}`,
      );
    }
    throw new Error(
      `mineskin: gave up submitting ${name} after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`,
    );
  }

  private async await(jobId: string): Promise<SignedTexture> {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await Bun.sleep(POLL_MS);
      const response = await fetch(
        `${BASE_URL}/v2/queue/${encodeURIComponent(jobId)}`,
        { headers: this.headers() },
      );
      const body = await this.parse(response);
      if (response.status === 429) {
        continue;
      }
      if (response.status !== 200) {
        throw new Error(
          `mineskin: ${String(response.status)} polling job ${jobId}: ${describe(body.errors)}`,
        );
      }
      const status = body.job?.status;
      if (status === "failed") {
        throw new Error(
          `mineskin: job ${jobId} failed: ${describe(body.errors)}`,
        );
      }
      if (status === "completed") {
        if (body.skin === undefined) {
          throw new Error(`mineskin: job ${jobId} completed without a skin`);
        }
        return toTexture(body.skin);
      }
    }
    throw new Error(
      `mineskin: job ${jobId} did not finish within ${String(MAX_WAIT_MS)} ms`,
    );
  }
}

function toTexture(skin: z.infer<typeof SkinSchema>): SignedTexture {
  return {
    value: skin.texture.data.value,
    signature: skin.texture.data.signature,
    mineskinUuid: skin.uuid,
    textureUrl: skin.texture.url.skin,
    duplicate: skin.duplicate ?? false,
  };
}
