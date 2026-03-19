# Bazel Bench — EC2 Profiling Instance

## Quick Reference

```bash
# Lifecycle
uv run scripts/bench.py launch      # Create EC2 instance
uv run scripts/bench.py setup       # NVMe, deps, clone, mise, bun, bazel fetch
uv run scripts/bench.py profile     # Run build matrix in tmux
uv run scripts/bench.py collect     # Download results to local machine
uv run scripts/bench.py teardown    # Terminate + clean up all AWS resources

# Utilities
uv run scripts/bench.py ssh         # SSH into the instance
uv run scripts/bench.py status      # Instance state, elapsed time, cost estimate
```

## SSH Access

```bash
# Via bench.py (reads state.json automatically)
uv run scripts/bench.py ssh

# Or manually
ssh -i ~/.cache/bazel-bench/bazel-bench-*.pem ubuntu@<IP>
```

The IP and key path are in `~/.cache/bazel-bench/state.json`.

## Syncing Files

### Full rsync (what `setup` does)

```bash
rsync -avz --delete \
  --exclude=.git/ --exclude=node_modules/ --exclude='bazel-*' \
  --exclude=target/ --exclude=dist/ --exclude=.build/ --exclude=.claude/ \
  -e "ssh -i ~/.cache/bazel-bench/bazel-bench-*.pem -o StrictHostKeyChecking=no" \
  ~/git/monorepo/ \
  ubuntu@<IP>:/mnt/nvme/repo/monorepo/
```

### Quick sync of a single file

```bash
scp -i ~/.cache/bazel-bench/bazel-bench-*.pem \
  ~/git/monorepo/path/to/file \
  ubuntu@<IP>:/mnt/nvme/repo/monorepo/path/to/file
```

### Pulling results back

```bash
scp -r -i ~/.cache/bazel-bench/bazel-bench-*.pem \
  ubuntu@<IP>:/mnt/nvme/results/ \
  ./bench-results/
```

## Remote Directory Layout

```
/mnt/nvme/                      # 3.5TB NVMe instance store (XFS)
├── repo/monorepo/              # The monorepo clone + rsync'd changes
├── bazel-output-base/          # Bazel output base (fast NVMe)
├── bazel-disk-cache/           # Per-run disk caches
├── results/                    # Profiling output
│   ├── timings.csv             # Wall time for each run
│   ├── build-info.txt          # Instance type, CPU, memory, git SHA
│   ├── profiles/               # Bazel .profile.gz and .pprof.gz files
│   └── bep/                    # Build Event Protocol .pb files
└── tmp/                        # Bind-mounted to /tmp
```

## Running Builds Manually

```bash
# SSH in
uv run scripts/bench.py ssh

# Bazel uses .bazelrc.bench overlay (written by setup)
cd /mnt/nvme/repo/monorepo
cat .bazelrc.bench
# startup --output_base=/mnt/nvme/bazel-output-base
# startup --host_jvm_args=-Xmx32g
# build --noremote_accept_cached
# build --noremote_upload_local_results
# build --noremote_local_fallback
# build --jobs=14

# Run a build with bench config
bazel --bazelrc=.bazelrc --bazelrc=.bazelrc.bench build //...

# Profile a specific target
bazel --bazelrc=.bazelrc --bazelrc=.bazelrc.bench build //packages/foo:bar \
  --profile=/mnt/nvme/results/profiles/my-test.profile.gz
```

## Automated Profiling (tmux)

```bash
# Start the full build matrix (runs in tmux, survives disconnects)
uv run scripts/bench.py profile

# Reconnect to watch
uv run scripts/bench.py ssh
tmux attach -t bench
# Ctrl-B D to detach

# Check progress without attaching
uv run scripts/bench.py ssh -- tmux capture-pane -t bench -p | tail -10
uv run scripts/bench.py ssh -- cat /mnt/nvme/results/timings.csv
```

## Viewing Results

- **Bazel profiles**: Open `.profile.gz` files at https://ui.perfetto.dev
- **Starlark CPU profiles**: Open `.pprof.gz` with `go tool pprof`
- **BEP files**: Parse `.pb` files with `bazel-bep` or `bbp` tools

## Instance Details

- **Type**: i4i.4xlarge (16 vCPU, 128 GB RAM, 1x 3.75TB NVMe)
- **Cost**: ~$1.37/hr on-demand
- **Auto-shutdown**: 5 hours after launch (safety net)
- **OS**: Ubuntu 24.04
- **Tools**: mise (bun, bazelisk, rust, java, buildifier)

## Troubleshooting

- **`/tmp` full**: Setup bind-mounts `/tmp` to NVMe. If you skipped setup, do it manually:
  `sudo mount --bind /mnt/nvme/tmp /tmp && sudo chmod 1777 /tmp`
- **`bazel` not found**: Use `bazelisk` or add mise shims to PATH:
  `export PATH=$HOME/.local/share/mise/shims:$PATH`
- **Cargo lockfile frozen**: After rsync, run `cargo generate-lockfile` in the relevant crate
- **Orphaned AWS resources**: `aws ec2 describe-instances --filters "Name=tag:Name,Values=bazel-bench"` and `aws ec2 describe-security-groups --filters "Name=group-name,Values=bazel-bench-*"`
