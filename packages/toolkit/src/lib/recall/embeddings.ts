import { z } from "zod";
import { EMBEDDING_DIM } from "./config.ts";

const ReadyMessage = z.object({ error: z.string().optional(), ready: z.boolean().optional() });
const EmbedResponse = z.object({ embeddings: z.array(z.array(z.number())).optional(), error: z.string().optional() });

interface StdinWriter {
  write(data: string): void;
  flush(): void;
  end(): void;
}

interface ReadResult {
  value: Uint8Array | undefined;
  done: boolean;
}

interface TypedReader {
  read(): Promise<ReadResult>;
}

function getReader(stdout: unknown): TypedReader {
  const stream = stdout as ReadableStream<Uint8Array>;
  const raw = stream.getReader();
  return {
    async read(): Promise<ReadResult> {
      const result = await raw.read();
      return { value: result.value, done: result.done };
    },
  };
}

function getStdinWriter(stdin: unknown): StdinWriter {
  return stdin as StdinWriter;
}

const EMBED_SERVER_SCRIPT = `
import sys, os, json, warnings

# Suppress all non-JSON output that would corrupt the protocol
os.environ["TQDM_DISABLE"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
warnings.filterwarnings("ignore")

# Redirect stderr to devnull during import (suppresses model loading noise)
_stderr = sys.stderr
sys.stderr = open(os.devnull, "w")

try:
    from mlx_embedding_models.embedding import EmbeddingModel
except ImportError:
    sys.stderr = _stderr
    print(json.dumps({"error": "mlx-embedding-models not installed. Run: pip install mlx-embedding-models"}), flush=True)
    sys.exit(1)

model = EmbeddingModel.from_registry("bge-m3")
sys.stderr = _stderr
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        texts = req["texts"]
        # Split oversized texts into sub-chunks to stay under bge-m3 token limit
        max_chars = 800
        expanded = []
        index_map = []  # maps expanded index back to original index
        for i, t in enumerate(texts):
            if len(t) <= max_chars:
                expanded.append(t)
                index_map.append(i)
            else:
                # Split into sub-chunks, average their embeddings later
                for j in range(0, len(t), max_chars):
                    expanded.append(t[j:j+max_chars])
                    index_map.append(i)
        # Suppress tqdm during encode
        sys.stderr = open(os.devnull, "w")
        raw_embeddings = model.encode(expanded)
        sys.stderr = _stderr
        # Average sub-chunk embeddings back to original indices
        import numpy as np
        num_originals = len(texts)
        result = []
        for orig_idx in range(num_originals):
            sub_indices = [j for j, mapped in enumerate(index_map) if mapped == orig_idx]
            if len(sub_indices) == 1:
                result.append(raw_embeddings[sub_indices[0]].tolist())
            else:
                avg = np.mean([raw_embeddings[j] for j in sub_indices], axis=0)
                avg = avg / np.linalg.norm(avg)  # re-normalize
                result.append(avg.tolist())
        print(json.dumps({"embeddings": result}), flush=True)
    except Exception as e:
        sys.stderr = _stderr
        print(json.dumps({"error": str(e)}), flush=True)
`;

export class EmbeddingClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private reader: TypedReader | null = null;
  private readonly decoder = new TextDecoder();
  private lineBuffer = "";
  private ready = false;
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.available != null) return this.available;

    try {
      const check = Bun.spawn(["python3", "-c", "import mlx_embedding_models"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await check.exited;

      if (check.exitCode === 0) {
        this.available = true;
        return true;
      }

      // Auto-install
      console.error("[embeddings] mlx-embedding-models not found, installing...");
      const install = Bun.spawn(["python3", "-m", "pip", "install", "--user", "mlx-embedding-models", "transformers<5", "einops"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      await install.exited;

      if (install.exitCode === 0) {
        console.error("[embeddings] installed successfully");
        this.available = true;
      } else {
        console.error("[embeddings] install failed, falling back to keyword search");
        this.available = false;
      }
    } catch {
      this.available = false;
    }

    return this.available;
  }

  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc != null) return;

    // Guard against double-spawn: kill any existing process
    if (this.proc != null) {
      try { this.proc.kill(); } catch { /* ignore */ }
      this.proc = null;
      this.reader = null;
      this.ready = false;
    }

    if (!(await this.isAvailable())) {
      throw new Error(
        "MLX embeddings not available. Install with: pip install mlx-embedding-models",
      );
    }

    this.proc = Bun.spawn(["python3", "-c", EMBED_SERVER_SCRIPT], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Keep a single reader for the lifetime of the process
    this.reader = getReader(this.proc.stdout);

    const firstLine = await this.readLine();
    if (firstLine == null) {
      throw new Error("Embedding server did not start");
    }

    let msg: z.infer<typeof ReadyMessage>;
    try {
      msg = ReadyMessage.parse(JSON.parse(firstLine));
    } catch {
      throw new Error(`Embedding server sent invalid startup message: ${firstLine.slice(0, 200)}`);
    }
    if (msg.error != null) {
      throw new Error(msg.error);
    }

    this.ready = true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureStarted();

    if (this.proc == null) {
      throw new Error("Embedding server not running");
    }

    const request = JSON.stringify({ texts }) + "\n";
    const stdin = getStdinWriter(this.proc.stdin);
    stdin.write(request);
    stdin.flush();

    const responseLine = await this.readLine();
    if (responseLine == null) {
      throw new Error("Embedding server returned no response");
    }

    let response: z.infer<typeof EmbedResponse>;
    try {
      response = EmbedResponse.parse(JSON.parse(responseLine));
    } catch {
      // If Zod parse fails, try raw JSON
      const raw = JSON.parse(responseLine) as Record<string, unknown>;
      if (typeof raw["error"] === "string") {
        throw new Error(`Embedding error: ${raw["error"]}`);
      }
      throw new Error(`Invalid embedding response: ${responseLine.slice(0, 200)}`);
    }

    if (response.error != null) {
      throw new Error(`Embedding error: ${response.error}`);
    }

    if (response.embeddings == null) {
      throw new Error("No embeddings in response");
    }

    return response.embeddings;
  }

  private async readLine(timeoutMs: number = 30_000): Promise<string | null> {
    if (this.reader == null) return null;

    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const newlineIdx = this.lineBuffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = this.lineBuffer.slice(0, newlineIdx);
        this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
        return line;
      }

      if (Date.now() > deadline) {
        throw new Error("Embedding server read timeout");
      }

      const result = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Embedding server read timeout")), Math.max(1000, deadline - Date.now())),
        ),
      ]);

      if (result.done) {
        return this.lineBuffer.length > 0 ? this.lineBuffer : null;
      }
      if (result.value != null) {
        this.lineBuffer += this.decoder.decode(result.value, { stream: true });
      }
    }
  }

  shutdown(): void {
    if (this.proc != null) {
      try {
        const stdin = getStdinWriter(this.proc.stdin);
        stdin.end();
      } catch {
        // ignore
      }
      this.proc.kill();
      this.proc = null;
      this.reader = null;
      this.lineBuffer = "";
      this.ready = false;
    }
  }
}

/** Deterministic mock embeddings for testing (no MLX needed) */
export function mockEmbed(text: string): number[] {
  const vec = Array.from<number>({ length: EMBEDDING_DIM });
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = Math.trunc(hash * 31 + (text.codePointAt(i) ?? 0));
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    hash = Math.trunc(hash * 1_103_515_245 + 12_345);
    vec[i] = ((hash >> 16) & 0x7f_ff) / 0x7f_ff;
  }
  return vec;
}
