// Copied from packages/toolkit/src/lib/recall/embeddings.ts
// Self-contained — no cross-package dependency

import { EMBEDDING_DIM } from "./config.ts";

type StdinWriter = {
  write: (data: string) => void;
  flush: () => void;
  end: () => void;
};

type ReadResult = {
  value: Uint8Array | undefined;
  done: boolean;
};

type TypedReader = {
  read: () => Promise<ReadResult>;
};

function getReader(stdout: ReadableStream<Uint8Array>): TypedReader {
  const raw = stdout.getReader();
  return {
    async read(): Promise<ReadResult> {
      const result = await raw.read();
      return { value: result.value, done: result.done };
    },
  };
}

function getStdinWriter(proc: ReturnType<typeof Bun.spawn>): StdinWriter {
  const stdin = proc.stdin;
  if (stdin == null || typeof stdin === "number") {
    throw new Error("Process stdin not available");
  }
  return stdin;
}

const EMBED_SERVER_SCRIPT = `
import sys, os, json, warnings

os.environ["TQDM_DISABLE"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
warnings.filterwarnings("ignore")

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
        max_chars = 800
        expanded = []
        index_map = []
        for i, t in enumerate(texts):
            if len(t) <= max_chars:
                expanded.append(t)
                index_map.append(i)
            else:
                for j in range(0, len(t), max_chars):
                    expanded.append(t[j:j+max_chars])
                    index_map.append(i)
        sys.stderr = open(os.devnull, "w")
        raw_embeddings = model.encode(expanded)
        sys.stderr = _stderr
        import numpy as np
        num_originals = len(texts)
        result = []
        for orig_idx in range(num_originals):
            sub_indices = [j for j, mapped in enumerate(index_map) if mapped == orig_idx]
            if len(sub_indices) == 1:
                result.append(raw_embeddings[sub_indices[0]].tolist())
            else:
                avg = np.mean([raw_embeddings[j] for j in sub_indices], axis=0)
                avg = avg / np.linalg.norm(avg)
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
      const check = Bun.spawn(
        ["python3", "-c", "import mlx_embedding_models"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await check.exited;
      if (check.exitCode === 0) {
        this.available = true;
        return true;
      }
      console.error(
        "[embeddings] mlx-embedding-models not found, installing...",
      );
      const install = Bun.spawn(
        [
          "python3",
          "-m",
          "pip",
          "install",
          "--user",
          "mlx-embedding-models",
          "transformers<5",
          "einops",
        ],
        { stdout: "inherit", stderr: "inherit" },
      );
      await install.exited;
      if (install.exitCode === 0) {
        console.error("[embeddings] installed successfully");
        this.available = true;
      } else {
        console.error("[embeddings] install failed");
        this.available = false;
      }
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc != null) return;
    if (this.proc != null) {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
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
    const stdout = this.proc.stdout;
    if (stdout == null || typeof stdout === "number") {
      throw new Error("Embedding server stdout not available");
    }
    this.reader = getReader(stdout);
    const firstLine = await this.readLine();
    if (firstLine == null) throw new Error("Embedding server did not start");
    const msg = JSON.parse(firstLine) as { ready?: boolean; error?: string };
    if (msg.error) throw new Error(msg.error);
    this.ready = true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureStarted();
    if (this.proc == null) throw new Error("Embedding server not running");
    const request = JSON.stringify({ texts }) + "\n";
    const stdin = getStdinWriter(this.proc);
    stdin.write(request);
    stdin.flush();
    const responseLine = await this.readLine();
    if (responseLine == null)
      throw new Error("Embedding server returned no response");
    const response = JSON.parse(responseLine) as {
      embeddings?: number[][];
      error?: string;
    };
    if (response.error) throw new Error(`Embedding error: ${response.error}`);
    if (!response.embeddings) throw new Error("No embeddings in response");
    return response.embeddings;
  }

  private async readLine(timeoutMs = 60_000): Promise<string | null> {
    if (this.reader == null) return null;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const newlineIdx = this.lineBuffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = this.lineBuffer.slice(0, newlineIdx);
        this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);
        return line;
      }
      if (Date.now() > deadline)
        throw new Error("Embedding server read timeout");
      const result = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Embedding server read timeout")),
            Math.max(1000, deadline - Date.now()),
          ),
        ),
      ]);
      if (result.done)
        return this.lineBuffer.length > 0 ? this.lineBuffer : null;
      if (result.value != null)
        this.lineBuffer += this.decoder.decode(result.value, { stream: true });
    }
  }

  shutdown(): void {
    if (this.proc != null) {
      try {
        const stdin = getStdinWriter(this.proc);
        stdin.end();
      } catch {
        /* ignore */
      }
      this.proc.kill();
      this.proc = null;
      this.reader = null;
      this.lineBuffer = "";
      this.ready = false;
    }
  }
}

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
