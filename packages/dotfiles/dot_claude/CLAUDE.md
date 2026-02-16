# Global Claude Instructions

## Tool & Skill Usage — MANDATORY

Before doing ANY work, scan the available skills list for relevant skills and LOAD THEM. This is not optional.

- **ALWAYS load matching skills first** - If the task involves a technology that has a skill (Dagger, Docker, Terraform, Kubernetes, Git, TypeScript, etc.), load that skill BEFORE taking any action. Do not attempt to solve the problem without the skill.
- **Use MCP tools first** - When MCP servers provide relevant functionality, prefer them over manual approaches
- **Leverage plugins** - Check available plugins before implementing something from scratch
- **Use lightpanda for web browsing** - When fetching web pages, searching the web, or extracting content from URLs, prefer the lightpanda CLI (`lightpanda fetch --dump --strip_mode full --log_level fatal <url>`) over Playwright or other browser MCP tools. It's 10x faster with no server setup needed. Fall back to Playwright only for interactive page manipulation (clicking, form filling, screenshots) or complex SPAs that lightpanda can't handle.
- **Look deeper** - If CI is failing, a build tool is erroring, or infrastructure has issues, don't just report the surface error. Load the relevant skill and investigate the root cause. The user wants solutions, not descriptions of problems.

Examples of what NOT to do:
- Seeing Dagger CI failures and NOT loading the dagger-helper skill
- Seeing Kubernetes errors and NOT loading kubectl-helper
- Seeing TypeScript errors and NOT loading typescript-helper
- Reporting "your API key is expired" without investigating how to fix it

## Task Completion — Own the Outcome

When asked to get CI passing, fix a build, fix lints, or complete any task with a clear success criterion:

- **Finish the job.** Do not stop until the task objectively succeeds (green CI, clean build, zero lint errors, etc.).
- **Never dismiss failures as "pre-existing."** If CI is red, the build is broken, or lints fail, fix them — regardless of whether you introduced the issue or it existed before. The user asked you to make it pass, not to explain why it doesn't.
- **Banned phrases / patterns:** Do not say things like "pre-existing issue", "unrelated to my changes", "not introduced by this PR", or "out of scope" as justification for leaving something broken. If you were told to make it work, make it work.
- **If truly blocked**, explain exactly what is blocking you and what you tried, then ask for guidance — do not just declare the task done.
