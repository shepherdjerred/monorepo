#!/usr/bin/env python3
"""
Prometheus exporter for Cloudflare R2 bucket storage metrics.
Uses the Cloudflare REST API to fetch bucket usage statistics.
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Configuration from environment variables
API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
BUCKET_NAMES = [bucket.strip() for bucket in os.environ.get("R2_BUCKET_NAMES", "homelab").split(",") if bucket.strip()]
SCRAPE_INTERVAL = int(os.environ.get("SCRAPE_INTERVAL_SECONDS", "300"))
PORT = int(os.environ.get("EXPORTER_PORT", "9199"))

# Cached metrics
metrics_cache: dict[str, dict[str, Any]] = {
    bucket: {
        "storage_bytes": 0,
        "object_count": 0,
        "last_scrape_time": 0,
        "last_scrape_success": False,
        "last_error": "",
        "lock_prefix_seconds": {},
    }
    for bucket in BUCKET_NAMES
}


def fetch_r2_usage(bucket_name: str):
    """Fetch R2 bucket usage from Cloudflare API."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/r2/buckets/{bucket_name}/usage"
    cache = metrics_cache[bucket_name]

    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        request = Request(url, headers=headers)
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))

            if data.get("success"):
                result = data.get("result", {})
                cache["storage_bytes"] = result.get("payloadSize", 0)
                cache["object_count"] = result.get("objectCount", 0)
                cache["last_scrape_success"] = True
                cache["last_error"] = ""
                print(
                    f"Successfully fetched R2 metrics for {bucket_name}: "
                    f"{cache['storage_bytes']} bytes, {cache['object_count']} objects"
                )
            else:
                errors = data.get("errors", [])
                error_msg = "; ".join(e.get("message", "Unknown error") for e in errors)
                cache["last_scrape_success"] = False
                cache["last_error"] = error_msg
                print(f"API returned errors: {error_msg}")

    except HTTPError as e:
        cache["last_scrape_success"] = False
        cache["last_error"] = f"HTTP {e.code}: {e.reason}"
        print(f"HTTP error fetching R2 usage: {e}")
    except URLError as e:
        cache["last_scrape_success"] = False
        cache["last_error"] = str(e.reason)
        print(f"URL error fetching R2 usage: {e}")
    except Exception as e:
        cache["last_scrape_success"] = False
        cache["last_error"] = str(e)
        print(f"Error fetching R2 usage: {e}")

    cache["last_scrape_time"] = time.time()


def fetch_r2_lock(bucket_name: str):
    """Fetch effective age locks for a bucket."""
    cache = metrics_cache[bucket_name]
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/r2/buckets/{bucket_name}/lock"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        request = Request(url, headers=headers)
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            if not data.get("success"):
                raise RuntimeError(f"Lock API returned errors for {bucket_name}")
            prefix_seconds: dict[str, int] = {}
            for rule in data.get("result", {}).get("rules", []):
                if not rule.get("enabled"):
                    continue
                condition = rule.get("condition", {})
                if condition.get("type") != "Age":
                    continue
                prefix = rule.get("prefix", "")
                prefix_seconds[prefix] = max(
                    prefix_seconds.get(prefix, 0),
                    condition.get("maxAgeSeconds", 0),
                )
            cache["lock_prefix_seconds"] = prefix_seconds
    except HTTPError as error:
        cache["last_scrape_success"] = False
        cache["last_error"] = f"Lock HTTP {error.code}: {error.reason}"
        print(f"HTTP error fetching R2 lock for {bucket_name}: {error}")
    except URLError as error:
        cache["last_scrape_success"] = False
        cache["last_error"] = f"Lock URL error: {error.reason}"
        print(f"URL error fetching R2 lock for {bucket_name}: {error}")
    except Exception as error:
        cache["last_scrape_success"] = False
        cache["last_error"] = f"Lock error: {error}"
        print(f"Error fetching R2 lock for {bucket_name}: {error}")


def scrape_loop():
    """Background thread that periodically fetches R2 metrics."""
    while True:
        for bucket_name in BUCKET_NAMES:
            fetch_r2_usage(bucket_name)
            if bucket_name == "seaweedfs-backups":
                fetch_r2_lock(bucket_name)
        time.sleep(SCRAPE_INTERVAL)


def generate_metrics():
    """Generate Prometheus metrics output."""
    lines = []

    # Storage bytes metric
    lines.append("# HELP cloudflare_r2_storage_bytes Total storage used by R2 bucket in bytes")
    lines.append("# TYPE cloudflare_r2_storage_bytes gauge")
    for bucket_name, cache in metrics_cache.items():
        lines.append(f'cloudflare_r2_storage_bytes{{bucket="{bucket_name}"}} {cache["storage_bytes"]}')

    # Object count metric
    lines.append("# HELP cloudflare_r2_object_count Number of objects in R2 bucket")
    lines.append("# TYPE cloudflare_r2_object_count gauge")
    for bucket_name, cache in metrics_cache.items():
        lines.append(f'cloudflare_r2_object_count{{bucket="{bucket_name}"}} {cache["object_count"]}')

    # Exporter status metrics
    lines.append("# HELP cloudflare_r2_exporter_last_scrape_timestamp_seconds Unix timestamp of last scrape")
    lines.append("# TYPE cloudflare_r2_exporter_last_scrape_timestamp_seconds gauge")
    for bucket_name, cache in metrics_cache.items():
        lines.append(
            f'cloudflare_r2_exporter_last_scrape_timestamp_seconds{{bucket="{bucket_name}"}} '
            f"{cache['last_scrape_time']}"
        )

    lines.append(
        "# HELP cloudflare_r2_exporter_scrape_success Whether the last scrape was successful (1=success, 0=failure)"
    )
    lines.append("# TYPE cloudflare_r2_exporter_scrape_success gauge")
    for bucket_name, cache in metrics_cache.items():
        lines.append(
            f'cloudflare_r2_exporter_scrape_success{{bucket="{bucket_name}"}} '
            f"{1 if cache['last_scrape_success'] else 0}"
        )

    lines.append("# HELP cloudflare_r2_bucket_lock_age_seconds Effective age lock by bucket prefix")
    lines.append("# TYPE cloudflare_r2_bucket_lock_age_seconds gauge")
    for bucket_name, cache in metrics_cache.items():
        for prefix, seconds in cache["lock_prefix_seconds"].items():
            lines.append(f'cloudflare_r2_bucket_lock_age_seconds{{bucket="{bucket_name}",prefix="{prefix}"}} {seconds}')

    return "\n".join(lines) + "\n"


class MetricsHandler(BaseHTTPRequestHandler):
    """HTTP handler for /metrics endpoint."""

    def do_GET(self):
        if self.path == "/metrics":
            metrics = generate_metrics()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(metrics)))
            self.end_headers()
            self.wfile.write(metrics.encode("utf-8"))
        elif self.path == "/health" or self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OK\n")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default logging for cleaner output."""
        pass


def main():
    if not API_TOKEN:
        print("ERROR: CLOUDFLARE_API_TOKEN environment variable is required")
        exit(1)
    if not ACCOUNT_ID:
        print("ERROR: CLOUDFLARE_ACCOUNT_ID environment variable is required")
        exit(1)

    print(f"Starting R2 exporter for buckets {','.join(BUCKET_NAMES)}")
    print(f"Scrape interval: {SCRAPE_INTERVAL}s")
    print(f"Listening on port {PORT}")

    # Start background scrape thread
    scrape_thread = Thread(target=scrape_loop, daemon=True)
    scrape_thread.start()

    # Perform initial scrape
    for bucket_name in BUCKET_NAMES:
        fetch_r2_usage(bucket_name)
        if bucket_name == "seaweedfs-backups":
            fetch_r2_lock(bucket_name)

    # Start HTTP server
    server = HTTPServer(("", PORT), MetricsHandler)
    print(f"R2 exporter listening on :{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
