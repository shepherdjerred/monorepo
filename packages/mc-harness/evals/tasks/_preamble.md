You are being evaluated on how well you use this repository's Minecraft agent harness. Work autonomously; do not ask questions — make reasonable assumptions and finish the task.

Environment:

- Your working directory is a checkout of the monorepo. `toolkit` on PATH runs this checkout's toolkit; use `toolkit mc …` for everything Minecraft.
- Read the skill(s) before acting: `.agents/skills/minecraft-harness/SKILL.md` (and the `references/` it routes to), and for building also `.agents/skills/minecraft-building/SKILL.md` plus its `references/`. Package READMEs (`packages/mc-harness/README.md`, `packages/mc-build/README.md`) have more detail.
- MCBridge.jar is already built. Docker is available. Sandboxes boot in ~20–60 s.

Rules:

- Work only on local Docker sandboxes you create (`paper` profile). Never target `live`.
- Do not modify repository source files, except where the task explicitly allows. Write deliverables only to the OUT directory given below.
- Do not commit, push, or open PRs.
- Leave the graded sandbox running and the daemon running when you finish (the grader inspects the world afterwards). Remove any other sandboxes you created.
- Finish with `OUT/result.json` exactly as specified, then a short plain-text summary of what you did and any harness problems you hit.
