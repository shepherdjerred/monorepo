"""Benchmark pdf-extract against datalab-to/marker_benchmark.

Downloads a small subset of diverse pages, runs the pipeline,
and scores extracted text against ground truth.

Usage:
    cd packages/pdf-extract
    uv run python benchmarks/run_benchmark.py [--pages 10] [--fast]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# Load .env file
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip()


def download_subset(num_pages: int) -> list[dict]:
    """Download a diverse subset from marker_benchmark."""
    from datasets import load_dataset

    print(f"Downloading marker_benchmark (streaming {num_pages} pages)...")
    ds = load_dataset("datalab-to/marker_benchmark", split="train", streaming=True)

    # Collect pages, trying to get diversity by classification
    seen_types: dict[str, int] = {}
    pages: list[dict] = []

    for row in ds:
        cls = row.get("classification", "unknown")
        if seen_types.get(cls, 0) >= max(2, num_pages // 5):
            continue  # Enough of this type

        # Must have ground truth
        gt = row.get("gt_blocks", "")
        if not gt or len(gt.strip()) < 50:
            continue

        pages.append({
            "pdf": row["pdf"],  # dict with 'bytes' and 'path' keys
            "gt_blocks": gt,
            "classification": cls,
            "language": row.get("language", "unknown"),
        })
        seen_types[cls] = seen_types.get(cls, 0) + 1

        if len(pages) >= num_pages:
            break

    print(f"Downloaded {len(pages)} pages:")
    for cls, count in sorted(seen_types.items()):
        print(f"  {cls}: {count}")
    return pages


def score(predicted: str, reference: str) -> dict[str, float]:
    """Score predicted text against ground truth."""
    from rapidfuzz.distance import Levenshtein

    # Normalize
    pred = predicted.strip()
    ref = reference.strip()

    if not ref:
        return {"edit_similarity": 1.0 if not pred else 0.0, "rouge_l": 0.0}

    # Edit similarity (1 - normalized edit distance)
    max_len = max(len(pred), len(ref), 1)
    edit_sim = 1.0 - Levenshtein.distance(pred, ref) / max_len

    # ROUGE-L
    try:
        from rouge_score import rouge_scorer
        scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
        rouge = scorer.score(ref, pred)
        rouge_l = rouge["rougeL"].fmeasure
    except Exception:
        rouge_l = 0.0

    return {"edit_similarity": edit_sim, "rouge_l": rouge_l}


async def run_pipeline_on_pdf(pdf_bytes: bytes, output_dir: Path, fast: bool) -> str:
    """Run our pipeline on a PDF and return extracted markdown."""
    from pdf_extract.config import PipelineConfig
    from pdf_extract.pipeline import extract_pdf

    # Write PDF to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        pdf_path = f.name

    config = PipelineConfig(
        output_dir=output_dir,
        backend="docling",
        docling_vlm=False,
        verify_enabled=not fast,
        handwriting_enabled=not fast,
        preprocess_mode="never" if fast else "on_failure",
    )

    try:
        markdown, _metrics = await extract_pdf(pdf_path, config)
        # Strip the quality report comment
        if "<!--" in markdown:
            markdown = markdown[:markdown.index("<!--")].strip()
        return markdown
    except Exception as e:
        return f"[ERROR: {e}]"
    finally:
        Path(pdf_path).unlink(missing_ok=True)


def strip_gt_blocks(gt_blocks: str) -> str:
    """Extract plain text from gt_blocks JSON.

    gt_blocks is a JSON array of objects with 'html' keys containing HTML text.
    We strip HTML tags to get plain text.
    """
    import re

    try:
        blocks = json.loads(gt_blocks)
        if isinstance(blocks, list):
            texts = []
            for block in blocks:
                if isinstance(block, dict):
                    # Try 'html' field first (marker_benchmark format)
                    html = block.get("html", "") or block.get("text", "")
                    # Strip HTML tags
                    plain = re.sub(r"<[^>]+>", "", html).strip()
                    if plain:
                        texts.append(plain)
                elif isinstance(block, str):
                    texts.append(block)
            return "\n\n".join(t for t in texts if t.strip())
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback: treat as plain text
    return gt_blocks


async def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark pdf-extract")
    parser.add_argument("--pages", type=int, default=10, help="Number of pages to benchmark")
    parser.add_argument("--fast", action="store_true", help="Fast mode (extraction only, no verification)")
    args = parser.parse_args()

    pages = download_subset(args.pages)
    if not pages:
        print("No pages downloaded!")
        return

    results: list[dict] = []
    total_start = time.monotonic()

    for i, page in enumerate(pages):
        print(f"\n[{i+1}/{len(pages)}] {page['classification']} ({page['language']})")

        pdf_data = page["pdf"]
        pdf_bytes = pdf_data["bytes"] if isinstance(pdf_data, dict) else bytes(pdf_data)

        with tempfile.TemporaryDirectory() as tmpdir:
            start = time.monotonic()
            extracted = await run_pipeline_on_pdf(pdf_bytes, Path(tmpdir), args.fast)
            duration = time.monotonic() - start

        gt_text = strip_gt_blocks(page["gt_blocks"])
        scores = score(extracted, gt_text)

        results.append({
            "index": i,
            "classification": page["classification"],
            "language": page["language"],
            "gt_chars": len(gt_text),
            "extracted_chars": len(extracted),
            "edit_similarity": scores["edit_similarity"],
            "rouge_l": scores["rouge_l"],
            "duration_s": duration,
            "error": extracted.startswith("[ERROR"),
        })

        status = "ERROR" if results[-1]["error"] else "OK"
        print(f"  {status} | edit_sim={scores['edit_similarity']:.3f} | rouge_l={scores['rouge_l']:.3f} | {duration:.1f}s | {len(gt_text)} gt chars → {len(extracted)} extracted")

    total_duration = time.monotonic() - total_start

    # Summary
    ok_results = [r for r in results if not r["error"]]
    print(f"\n{'='*70}")
    print(f"BENCHMARK RESULTS ({len(ok_results)}/{len(results)} successful)")
    print(f"{'='*70}")

    if ok_results:
        avg_edit = sum(r["edit_similarity"] for r in ok_results) / len(ok_results)
        avg_rouge = sum(r["rouge_l"] for r in ok_results) / len(ok_results)
        avg_duration = sum(r["duration_s"] for r in ok_results) / len(ok_results)

        print(f"  Avg edit similarity: {avg_edit:.3f}")
        print(f"  Avg ROUGE-L:         {avg_rouge:.3f}")
        print(f"  Avg duration/page:   {avg_duration:.1f}s")
        print(f"  Total duration:      {total_duration:.1f}s")

        print(f"\nBy document type:")
        by_type: dict[str, list[dict]] = {}
        for r in ok_results:
            by_type.setdefault(r["classification"], []).append(r)
        for cls, cls_results in sorted(by_type.items()):
            avg_e = sum(r["edit_similarity"] for r in cls_results) / len(cls_results)
            avg_r = sum(r["rouge_l"] for r in cls_results) / len(cls_results)
            print(f"  {cls:20s} edit_sim={avg_e:.3f}  rouge_l={avg_r:.3f}  (n={len(cls_results)})")

    errors = [r for r in results if r["error"]]
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for r in errors:
            print(f"  [{r['index']}] {r['classification']}")

    # Save raw results
    out_path = Path(__file__).parent / "results.json"
    out_path.write_text(json.dumps(results, indent=2))
    print(f"\nRaw results saved to: {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
