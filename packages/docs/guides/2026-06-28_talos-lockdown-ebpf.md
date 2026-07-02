# Talos Kernel Lockdown Breaks eBPF Profiling

## Status

Complete (resolved 2026-06-12 on torvalds).

## Symptom

All eBPF profiling goes dark cluster-wide (Alloy `pyroscope.ebpf` → Pyroscope produces no profiles).

## Root cause

Talos appends `lockdown=confidentiality` to the kernel cmdline on **secure-boot** installs (`SecureBootArgs` in `pkg/machinery/kernel/kernel.go`). Confidentiality lockdown denies `LOCKDOWN_BPF_READ_KERNEL`, so the verifier rejects every `bpf_probe_read*` helper.

## The misleading error

The surfaced error is `program of this type cannot use helper bpf_probe_read#4` even though the profiler bytecode never uses the legacy helper. Under lockdown, cilium/ebpf's `haveProbeReadKernel` feature probe also fails, so `fixupProbeReadKernel` silently rewrites helper #113 (`bpf_probe_read_kernel`) to legacy #4 (`bpf_probe_read`). **Don't chase the helper name** — check `talosctl read /sys/kernel/security/lockdown` first.

## Fix

Owner switched torvalds to `lockdown=integrity` (blocks kernel writes, permits BPF reads) via image-schematic `extraKernelArgs`; the eBPF tracer loaded immediately and ~100 services got profiles within minutes. If torvalds is ever reinstalled with secure boot, lockdown reverts to confidentiality and this breaks again. See also the talos-helper skill's homelab upgrade gotchas.
