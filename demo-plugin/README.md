# Demo Plugin

A simple demo plugin to showcase basic Claude Code plugin functionality.

## What's Included

This demo plugin includes:

- **Slash Command**: `/demo-plugin:hype` - Get encouraging messages for your coding session
- **Agent**: `code-explainer` - Automatically activates when you ask Claude to explain code

## How to Use

### Install the Plugin

Run Claude Code with this plugin:

```bash
claude --plugin-dir ./demo-plugin
```

### Try the Slash Command

Once Claude Code is running, try:

```shell
/demo-plugin:hype
```

Or with a topic:

```shell
/demo-plugin:hype debugging
```

### Try the Agent

The agent automatically activates when you ask questions like:

- "Explain this code"
- "What does this function do?"
- "How does this work?"

The `code-explainer` agent will give you friendly, beginner-friendly explanations.

## Plugin Structure

```
demo-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── commands/
│   └── hype.md              # Slash command definition
├── agents/
│   └── code-explainer.md    # Agent definition
└── README.md                # This file
```

## Next Steps

This is just a demo! For your real plugin, you can:

- Add more commands with different functionality
- Create specialized agents for specific tasks
- Add hooks to automate workflows
- Integrate MCP servers for external services
- Add skills for autonomous capabilities

Check out the [Plugin Documentation](https://code.claude.com/docs/en/plugins.md) for more details.
