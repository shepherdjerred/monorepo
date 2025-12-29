---
description: Mastra AI agent framework for TypeScript - agents, tools, workflows, memory, and MCP integration
when_to_use: When user works with Mastra, AI agents, LLM orchestration, or mentions mastra commands and patterns
---

# Mastra Helper Agent

## What's New in Mastra v1 (2025)

- **Stable API**: v1 beta signals production-readiness with no breaking changes planned
- **Multi-model support**: OpenAI, Anthropic, Gemini, Llama, and more through AI SDK integration
- **Human-in-the-loop**: Suspend/resume with persistent state across sessions
- **MCP integration**: Model Context Protocol for universal tool sharing
- **Built-in evals**: Automated testing with model-graded and rule-based scoring
- **Enhanced memory**: Working memory, semantic recall, and conversation history

## Installation

```bash
# Create new Mastra project
npm create mastra@latest

# Or add to existing project
npm install @mastra/core
```

## Core Concepts

Mastra provides:
1. **Agents**: Autonomous LLM-powered systems with tools
2. **Tools**: Functions agents can call to interact with external systems
3. **Workflows**: Graph-based orchestration for multi-step processes
4. **Memory**: Context management across conversations
5. **MCP**: Model Context Protocol for tool/resource sharing

## Creating Agents

### Basic Agent

```typescript
import { Agent } from "@mastra/core/agent";

export const myAgent = new Agent({
  name: "my-agent",
  instructions: "You are a helpful assistant that answers questions clearly.",
  model: "openai/gpt-4o-mini",
});
```

### Agent with Tools

```typescript
import { Agent } from "@mastra/core/agent";
import { weatherTool, searchTool } from "./tools";

export const assistantAgent = new Agent({
  name: "assistant",
  instructions: `You are a helpful assistant.
    Use the weather tool to check weather conditions.
    Use the search tool to find information.`,
  model: "anthropic/claude-sonnet-4-20250514",
  tools: { weatherTool, searchTool },
});
```

### Agent Configuration Options

```typescript
export const agent = new Agent({
  name: "configured-agent",
  instructions: "Your system prompt here",
  model: "openai/gpt-4o",

  // Limit sequential LLM calls (default: 5)
  maxSteps: 10,

  // Callback after each step
  onStepFinish: async ({ step, result }) => {
    console.log(`Step ${step} completed:`, result);
  },

  // Callback after completion
  onFinish: async ({ result, usage }) => {
    console.log("Total tokens:", usage.totalTokens);
  },
});
```

### Dynamic Configuration with RuntimeContext

```typescript
import { Agent, RuntimeContext } from "@mastra/core/agent";

export const agent = new Agent({
  name: "dynamic-agent",

  // Dynamic model selection
  model: async ({ runtimeContext }) => {
    const tier = runtimeContext.get("user-tier");
    return tier === "enterprise" ? "openai/gpt-4o" : "openai/gpt-4o-mini";
  },

  // Dynamic instructions
  instructions: async ({ runtimeContext }) => {
    const lang = runtimeContext.get("language");
    return `Respond in ${lang}. Be helpful and concise.`;
  },
});

// Usage
const ctx = new RuntimeContext();
ctx.set("user-tier", "enterprise");
ctx.set("language", "Spanish");

await agent.generate("Hello!", { runtimeContext: ctx });
```

## Using Agents

### Generate Text

```typescript
const result = await agent.generate("What's the weather in Tokyo?");
console.log(result.text);
```

### Stream Response

```typescript
const stream = await agent.stream("Tell me a story");

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

### Structured Output

```typescript
import { z } from "zod";

const WeatherSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  conditions: z.string(),
  humidity: z.number(),
});

const result = await agent.generate("Get weather for NYC", {
  output: WeatherSchema,
});

// result.object is typed: { location, temperature, conditions, humidity }
console.log(result.object.temperature);
```

## Creating Tools

### Basic Tool

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const weatherTool = createTool({
  id: "weather-tool",
  description: "Fetches current weather for a location",

  inputSchema: z.object({
    location: z.string().describe("City name or coordinates"),
  }),

  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
    humidity: z.number(),
  }),

  execute: async ({ context }) => {
    const { location } = context;

    // Fetch weather from API
    const response = await fetch(`https://api.weather.com/${location}`);
    const data = await response.json();

    return {
      temperature: data.temp,
      conditions: data.weather,
      humidity: data.humidity,
    };
  },
});
```

### Tool with Runtime Context

```typescript
export const apiTool = createTool({
  id: "api-tool",
  description: "Makes authenticated API calls",

  inputSchema: z.object({
    endpoint: z.string(),
  }),

  outputSchema: z.object({
    data: z.any(),
  }),

  execute: async ({ context, runtimeContext }) => {
    const apiKey = runtimeContext.get("api-key");

    const response = await fetch(context.endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return { data: await response.json() };
  },
});
```

## Workflows

### Creating Steps

```typescript
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";

const fetchDataStep = createStep({
  id: "fetch-data",

  inputSchema: z.object({
    userId: z.string(),
  }),

  outputSchema: z.object({
    user: z.object({
      name: z.string(),
      email: z.string(),
    }),
  }),

  execute: async ({ inputData }) => {
    const user = await db.users.findUnique({ where: { id: inputData.userId } });
    return { user };
  },
});
```

### Creating Workflows

```typescript
import { createWorkflow } from "@mastra/core/workflows";

const userWorkflow = createWorkflow({
  id: "user-workflow",

  inputSchema: z.object({
    userId: z.string(),
  }),

  outputSchema: z.object({
    result: z.string(),
  }),
})
  .then(fetchDataStep)
  .then(processStep)
  .then(notifyStep)
  .commit();
```

### Branching

```typescript
const workflow = createWorkflow({ id: "branching-example", ... })
  .then(validateStep)
  .branch([
    // Condition: user is premium
    [async ({ inputData }) => inputData.isPremium, premiumProcessStep],
    // Condition: user is basic
    [async ({ inputData }) => !inputData.isPremium, basicProcessStep],
  ])
  .then(finalizeStep)
  .commit();
```

### Parallel Execution

```typescript
const workflow = createWorkflow({ id: "parallel-example", ... })
  .then(initialStep)
  .parallel([
    fetchFromApiA,
    fetchFromApiB,
    fetchFromApiC,
  ])
  .then(mergeResultsStep)
  .commit();
```

### Loops

```typescript
const workflow = createWorkflow({ id: "loop-example", ... })
  // Do-until loop
  .dountil(
    retryStep,
    async ({ inputData }) => inputData.success === true,
    { maxIterations: 5 }
  )

  // Do-while loop
  .dowhile(
    processItemStep,
    async ({ inputData }) => inputData.hasMore,
    { maxIterations: 100 }
  )

  // For-each loop
  .foreach(
    processItemStep,
    async ({ inputData }) => inputData.items,
    { concurrency: 3 }
  )
  .commit();
```

### Suspend and Resume (Human-in-the-Loop)

```typescript
const approvalStep = createStep({
  id: "await-approval",

  inputSchema: z.object({ requestId: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),

  resumeSchema: z.object({
    approved: z.boolean(),
    approverNotes: z.string().optional(),
  }),

  execute: async ({ inputData, suspend, resumeData }) => {
    // If we have resume data, use it
    if (resumeData) {
      return { approved: resumeData.approved };
    }

    // Otherwise, suspend and wait for human input
    await suspend({ requestId: inputData.requestId });
  },
});

// Resume suspended workflow
await workflow.resume({
  runId: "run-123",
  stepId: "await-approval",
  resumeData: { approved: true, approverNotes: "Looks good!" },
});
```

### Running Workflows

```typescript
// Start and wait for completion
const result = await workflow.start({
  inputData: { userId: "user-123" },
});

// Stream events during execution
const stream = await workflow.stream({
  inputData: { userId: "user-123" },
});

for await (const event of stream) {
  console.log(event.type, event.data);
}
```

## Memory

### Enabling Memory

```typescript
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

const memory = new Memory({
  // Storage adapter
  storage: new PostgresStorage({ connectionString: process.env.DATABASE_URL }),

  // Vector store for semantic recall
  vectorStore: new PgVector({ connectionString: process.env.DATABASE_URL }),

  // Embedding model
  embedder: openai.embedding("text-embedding-3-small"),
});

export const agent = new Agent({
  name: "memory-agent",
  instructions: "You are a helpful assistant with memory.",
  model: "openai/gpt-4o",
  memory,
});
```

### Memory Types

**Conversation History**: Recent messages in current conversation
```typescript
// Automatically managed - no configuration needed
```

**Working Memory**: Persistent user-specific data
```typescript
const memory = new Memory({
  workingMemory: {
    // Option 1: Markdown template
    template: `# User Profile
    - Name: {{name}}
    - Preferences: {{preferences}}`,

    // Option 2: Zod schema (structured)
    schema: z.object({
      name: z.string(),
      preferences: z.array(z.string()),
      lastSeen: z.string(),
    }),
  },
});
```

**Semantic Recall**: Vector-based retrieval of past conversations
```typescript
const memory = new Memory({
  semanticRecall: {
    topK: 5,              // Number of similar messages to retrieve
    messageRange: 2,      // Context around each match
    scope: "resource",    // "thread" or "resource"
  },
});
```

### Memory Scopes

```typescript
// Thread-scoped (default): isolated per conversation
const memory = new Memory({
  options: { workingMemory: { scope: "thread" } },
});

// Resource-scoped: persists across all threads for a user
const memory = new Memory({
  options: { workingMemory: { scope: "resource" } },
});
```

## MCP (Model Context Protocol)

### Using MCP Client

```typescript
import { MCPClient } from "@mastra/mcp";

const mcpClient = new MCPClient({
  servers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    },
    github: {
      url: new URL("https://mcp.github.com"),
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      },
    },
  },
});

// Get tools for agent
const tools = await mcpClient.getTools();

const agent = new Agent({
  name: "mcp-agent",
  model: "openai/gpt-4o",
  tools,
});
```

### Creating MCP Server

```typescript
import { MCPServer } from "@mastra/mcp";
import { mastra } from "./mastra";

const server = new MCPServer({
  name: "my-mcp-server",
  version: "1.0.0",
});

// Expose tools
server.registerTools(mastra.getTools());

// Expose agents
server.registerAgents(mastra.getAgents());

// Start server
await server.startHTTP({ port: 3001 });
```

## Storage

### Configuring Storage

```typescript
import { Mastra } from "@mastra/core";
import { PostgresStorage } from "@mastra/pg";

export const mastra = new Mastra({
  agents: { myAgent },

  storage: new PostgresStorage({
    connectionString: process.env.DATABASE_URL,
  }),
});
```

### Storage Adapters

| Adapter | Use Case | Package |
|---------|----------|---------|
| LibSQL | Local development | `@mastra/libsql` |
| PostgreSQL | Production | `@mastra/pg` |
| MongoDB | Document storage | `@mastra/mongodb` |
| Upstash | Serverless | `@mastra/upstash` |

## Evaluations

### Running Evals

```typescript
import { evaluate } from "@mastra/evals";

const results = await evaluate({
  agent: myAgent,

  testCases: [
    {
      input: "What's 2 + 2?",
      expected: "4",
    },
    {
      input: "Capital of France?",
      expected: "Paris",
    },
  ],

  scorers: [
    "accuracy",
    "similarity",
    "tone",
  ],
});

console.log(results.scores);
```

## Registering with Mastra

```typescript
import { Mastra } from "@mastra/core";
import { myAgent, assistantAgent } from "./agents";
import { userWorkflow } from "./workflows";

export const mastra = new Mastra({
  agents: { myAgent, assistantAgent },
  workflows: { userWorkflow },
  storage: new PostgresStorage({ ... }),
});

// Access registered components
const agent = mastra.getAgent("myAgent");
const workflow = mastra.getWorkflow("userWorkflow");
```

## Best Practices Summary

1. **Register agents** with Mastra instance for shared resources (memory, logging)
2. **Use RuntimeContext** for request-specific configuration instead of hardcoding
3. **Define clear tool descriptions** - agents select tools based on descriptions
4. **Use Zod schemas** for type-safe inputs/outputs in tools and workflows
5. **Configure storage** for production to persist state across restarts
6. **Enable semantic recall** for conversations needing long-term context
7. **Use structured output** when you need typed, validated responses
8. **Implement suspend/resume** for human-in-the-loop workflows
9. **Scope working memory** appropriately (thread vs resource)
10. **Run evals** to measure and improve agent quality

## When to Ask for Help

- Complex multi-agent orchestration patterns
- Custom storage adapter implementations
- Advanced MCP server configurations
- Performance optimization for high-throughput scenarios
- Integration with non-standard LLM providers
- Custom evaluation scorers and metrics
