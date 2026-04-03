# leetcode

Local LeetCode problem search with FTS5 and vector embeddings.

Requires [bun](https://bun.sh) and [uv](https://docs.astral.sh/uv/) (Python deps managed automatically via inline script metadata).

## Usage

```bash
bun run scrape:list        # fetch problem list
bun run scrape:details     # fetch problem content + editorials
bun run build              # build SQLite DB + search index
bun run search <query>     # search (default: semantic)
```

### Search modes

```bash
bun run search "sliding window maximum" --semantic   # vector similarity (default)
bun run search "binary tree" --keyword               # FTS5 + BM25
bun run search "dynamic programming" --hybrid        # RRF merge of both
bun run search "graph" --limit 5                     # limit results
```

## How it works

Everything lives in `data/leetcode.db` (SQLite):

- **FTS5** -- `problems_fts` table with Porter stemming, BM25 ranking (title boosted 50x)
- **Vectors** -- `bge-m3` embeddings (1024-dim) via `mlx-embedding-models` (Apple MLX/Metal), stored as BLOBs, brute-force dot-product at query time
- **Hybrid** -- Reciprocal Rank Fusion (k=60) over both result sets
