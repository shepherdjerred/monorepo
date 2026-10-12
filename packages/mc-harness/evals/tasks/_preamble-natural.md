You are working autonomously in a checkout of this monorepo; do not ask questions — make reasonable assumptions and finish the job. Use this repository's own guidance and tooling the way a contributor would.

Environment:

- `toolkit` on PATH runs this checkout's toolkit. MCBridge.jar is already built. Docker is available.

Rules:

- Work only on local Docker sandboxes you create. Never target the live server.
- Do not modify repository source files. Write deliverables only to the OUT directory given below.
- Do not commit, push, or open PRs.
- Leave the sandbox holding the finished map running, and the harness daemon running, when you finish (it is inspected afterwards). Remove any other sandboxes you created.
- Finish with `OUT/result.json` exactly as specified, then a short plain-text summary of what you built and any tooling problems you hit.
