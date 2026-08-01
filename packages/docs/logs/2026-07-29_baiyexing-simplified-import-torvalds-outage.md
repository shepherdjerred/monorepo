---
id: log-2026-07-29-baiyexing-simplified-import-torvalds-outage
type: log
status: complete
board: false
---

# 白夜行 simplified import + torvalds node outage

## Book task (done before the outage)

Goal: get the simplified-Chinese 《白夜行》 into the ebook stack and remove the
traditional/foreign-edition copies.

- **Finding (metadata search):** the title 白夜行 is script-identical, so a bare
  Bindery title search returns junk. Searching `白夜行 东野圭吾` (simplified
  author name) surfaces the simplified volume first: `gb:BUONzQEACAAJ`
  (`language: zh-CN`). Google Books still renders the author as 東野圭吾 on the
  zh-CN volume — the language tag is the only simplified/traditional signal.
- The user already had the simplified EPUB (`~/Downloads/白夜行.epub`; verified
  298× 东 / 0× 東 in content), so acquisition was unnecessary.
- **Manual drop path (guide's day-2 "Manual drop" row):** `kubectl cp` the EPUB
  into the CWA pod at `/cwa-book-ingest/` (the shared `ebooks-hdd-pvc` `ingest/`
  dir). CWA's ingest picked it up within a minute. Bypasses Bindery entirely —
  right tool for a file-in-hand.
- **Cleanup of unwanted copies:**
  - CWA library had 3 traditional/extra copies — book ids **2** and **4**
    (白夜行（2018年經典回歸版）, verified traditional content) and **3** ("Bai Ye
    Xing", also traditional). Deleted via CWA web API: session login →
    `POST /delete/<id>` with `csrf_token` (endpoint discovered in
    `/static/js/main.js`: `postButton(event, getPath() + "/delete/" + deleteId)`).
    Deletion removes both the DB row and files.
  - Kept book id **5** (the dropped simplified file; verified 298× 东 / 0× 東
    after ingest). It lives under the romanized author folder
    `[Ri ] Dong Ye Gui Wu/Bai Ye Xing (5)/`.
  - Bindery had 6 白夜行-related book entries from the earlier OpenLibrary
    author add — ids **14** (白夜行), **39**/**46** (English), **18** (German),
    **58**/**97** (pinyin "Bai ye xing"). All `DELETE /api/v1/book/<id>?deleteFiles=true`
    → 204. Zero `bai ye xing|白夜|midnight` matches remain.
  - qBittorrent: the earlier traditional grab
    (`東野圭吾(Keigo Higashino) - 白夜行（2018年經典回歸版） [EPUB-CHINESE].epub`,
    hash `01fff98dcd929ca5f915249cd779e965ad85b528`) was still seeding;
    deleted via qBit API with `deleteFiles=true` (in-pod `curl` against
    `localhost:8080`, creds from 1P `Homelab (Kubernetes)/qBittorrent`).

## torvalds outage (mid-session, unresolved)

- ~14:51 PDT: torvalds began a graceful shutdown (`KubeletNotReady: node is
shutting down`), rebooted, Talos boot sequence completed 14:54. All cluster
  Tailscale devices (tailscale-operator, every TailscaleIngress proxy) went
  offline simultaneously — they all live on torvalds.
- Node came back briefly: Talos `v1.13.7` (= the `versions.ts` pin, no drift),
  all Talos services healthy, `kubectl get nodes` showed `Ready` but
  `SchedulingDisabled`. `kubectl uncordon torvalds` returned "already
  uncordoned" and the taint cleared on its own.
- Media replacement pods went Pending → Init; qBittorrent hit
  `ErrImagePull`/`FailedMount`: **`zfs.csi.openebs.io` not registered on
  torvalds**. The `openebs-zfs-localpv-node` DaemonSet (DESIRED=1, only liskov
  has a Running pod) kept creating its torvalds pod and immediately deleting
  it as a "succeeded daemon pod" (plugin exits 0 instead of staying up). With
  no node plugin on torvalds, no ZFS volume can mount there — all prod
  stateful workloads are blocked on this once the node returns.
- ~15:00 PDT: torvalds dropped off the tailnet again (TSMP, ICMP, talos :50000
  and k8s :6443 all unreachable). Other tailnet devices (kvm, jerred-desktop,
  liskov) stayed online — site WAN is fine; this is the node itself. No remote
  recovery path (Talos: no SSH; kvm host refuses SSH). **Needs physical/console
  attention.**

## Session Log — 2026-07-29

### Done

- Simplified 白夜行 imported to CWA via `/cwa-book-ingest` kubectl-cp drop; kept
  as the sole copy (book id 5).
- Removed traditional/foreign copies: CWA books 2/3/4, Bindery books
  14/18/39/46/58/97, qBit torrent 01fff98d (+files).
- Diagnosed the torvalds reboot/flap and the ZFS CSI node-plugin gap.

### Recovery (same day, ~15:20 PDT)

- Node returned on its own (user-confirmed). `openebs-zfs-localpv-node` pod on
  torvalds came up Running 2/2 by itself; ZFS mounts recovered and all media
  pods (bindery/cwa/shelfbridge/qbittorrent) reached Running. The earlier
  "succeeded daemon pod" churn did not recur — no root cause identified for
  either the reboot or the plugin churn.
- **CWA book 5 metadata needed no fix:** the Calibre DB values were already
  correct (title 白夜行, authors `[日] 东野圭吾`, language Chinese). The odd
  `[Ri ] Dong Ye Gui Wu` folder name is just Calibre's ASCII transliteration
  of `[日]` on disk; the UI shows the proper metadata.
- Verified CWA search for 白夜行 returns exactly one book.
- **Bindery author flood:** user chose to leave author 東野圭吾 (id 3) and its
  ~80 OpenLibrary entries as-is.

### Caveats

- CWA rewrites ingested EPUBs (metadata enforcement/fixer), so hash-compare
  against the source file does not work; verify script by grepping content
  (东 vs 東) instead.
- The `deleteFiles=true` Bindery deletions had empty `filePath`s, so only the
  qBit manual delete actually removed payload data.
- What triggered the 14:51 reboot is still unknown (no version drift; graceful
  shutdown). If it recurs, check `talosctl dmesg` and hardware (thermals, PSU).
