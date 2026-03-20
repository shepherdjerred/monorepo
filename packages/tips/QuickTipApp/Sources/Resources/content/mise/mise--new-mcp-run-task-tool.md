---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- mise now exposes a `run_task` tool through its MCP (Model Context Protocol) server interface
- AI assistants and MCP clients can execute mise tasks directly with full stdout/stderr capture and timeout support
- This allows AI-powered development workflows to trigger builds, tests, and other project tasks through the MCP interface
- Start the MCP server and configure your MCP client to use `mise run_task` for seamless tool invocation
