# Data, benchmarks, and Git display

Read this when using jq, yq, hyperfine, or delta.

## jq

Treat the jq filter as code and input as data. Use `--arg` / `--argjson` rather than string interpolation. `-e` is useful in gates; `-r` changes output representation. Slurp can consume unbounded memory.

## yq

Mike Farah yq supports eval and in-place editing across YAML and other formats. Distinguish it from the Python yq wrapper. Review representation changes and null/missing semantics after mutation.

## hyperfine

Warm up, run enough samples, and export machine-readable results. Parameter scans are useful only when every case is comparable. Shell setup/cleanup and cache state can dominate a microbenchmark.

## delta

Delta is a Git pager, not a diff computation oracle. Keep pager themes and decoration out of scripts. Configure through Git after loading Git workflow guidance.

## Primary documentation

- [jq manual](https://jqlang.org/manual/)
- [jq releases](https://github.com/jqlang/jq/releases/latest)
- [yq documentation](https://mikefarah.gitbook.io/yq/)
- [yq releases](https://github.com/mikefarah/yq/releases/latest)
- [hyperfine](https://github.com/sharkdp/hyperfine)
- [hyperfine releases](https://github.com/sharkdp/hyperfine/releases/latest)
- [delta](https://github.com/dandavison/delta)
- [delta releases](https://github.com/dandavison/delta/releases/latest)
