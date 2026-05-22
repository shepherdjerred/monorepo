import { describe, expect, test } from "bun:test";
import {
  stripAnsi,
  extractCodeBlocks,
  extractFilePath,
  parseToolUses,
  parseMessages,
  MessageParser,
} from "./claude-parser.ts";

describe("stripAnsi", () => {
  test("removes ANSI color codes", () => {
    const input = "\u001B[32mgreen text\u001B[0m";
    expect(stripAnsi(input)).toBe("green text");
  });

  test("removes multiple ANSI codes", () => {
    const input = "\u001B[1m\u001B[31mBold Red\u001B[0m normal";
    expect(stripAnsi(input)).toBe("Bold Red normal");
  });

  test("preserves text without ANSI codes", () => {
    const input = "plain text";
    expect(stripAnsi(input)).toBe("plain text");
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("extractCodeBlocks", () => {
  test("extracts code block with language", () => {
    const input = "Some text\n```typescript\nconst x = 1;\n```\nMore text";
    const blocks = extractCodeBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      language: "typescript",
      code: "const x = 1;",
    });
  });

  test("extracts code block without language", () => {
    const input = "```\nplain code\n```";
    const blocks = extractCodeBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      language: "text",
      code: "plain code",
    });
  });

  test("extracts multiple code blocks", () => {
    const input = "```js\ncode1\n```\ntext\n```python\ncode2\n```";
    const blocks = extractCodeBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.language).toBe("js");
    expect(blocks[1]?.language).toBe("python");
  });

  test("returns empty array for no code blocks", () => {
    const input = "just plain text";
    expect(extractCodeBlocks(input)).toEqual([]);
  });
});

describe("extractFilePath", () => {
  test("extracts file_path with double quotes", () => {
    const input = 'file_path: "/path/to/file.ts"';
    expect(extractFilePath(input)).toBe("/path/to/file.ts");
  });

  test("extracts file_path with single quotes", () => {
    const input = "file_path: '/path/to/file.ts'";
    expect(extractFilePath(input)).toBe("/path/to/file.ts");
  });

  test("extracts Reading pattern", () => {
    const input = "Reading /path/to/file.ts";
    expect(extractFilePath(input)).toBe("/path/to/file.ts");
  });

  test("extracts Writing to pattern", () => {
    const input = "Writing to /path/to/file.ts";
    expect(extractFilePath(input)).toBe("/path/to/file.ts");
  });

  test("extracts Writing pattern without 'to'", () => {
    const input = "Writing /path/to/file.ts";
    expect(extractFilePath(input)).toBe("/path/to/file.ts");
  });

  test("returns undefined for no match", () => {
    const input = "just some text";
    expect(extractFilePath(input)).toBeUndefined();
  });
});

describe("parseToolUses", () => {
  test("parses Read tool", () => {
    const input = "Reading /path/to/file.ts";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: "Read",
      description: "/path/to/file.ts",
      input: undefined,
      result: undefined,
    });
  });

  test("parses Write tool", () => {
    const input = "Writing to /path/to/file.ts";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("Write");
  });

  test("parses Edit tool", () => {
    const input = "Editing /path/to/file.ts";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("Edit");
  });

  test("parses Bash tool", () => {
    const input = "Running: npm install";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: "Bash",
      description: "npm install",
      input: undefined,
      result: undefined,
    });
  });

  test("parses Grep tool", () => {
    const input = "Searching for pattern in files";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("Grep");
  });

  test("parses Glob tool", () => {
    const input = "Finding files: **/*.ts";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("Glob");
  });

  test("parses multiple tools in one text", () => {
    const input = "Reading /file1.ts\nWriting to /file2.ts";
    const tools = parseToolUses(input);
    expect(tools).toHaveLength(2);
  });

  test("returns empty array for no tools", () => {
    const input = "just some text";
    expect(parseToolUses(input)).toEqual([]);
  });
});

describe("parseMessages", () => {
  test("parses user message with > prefix", () => {
    const input = "> Hello Claude";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello Claude");
  });

  test("parses user message with User: prefix", () => {
    const input = "User: Hello Claude";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Hello Claude");
  });

  test("parses assistant message with Assistant: prefix", () => {
    const input = "Assistant: Hello! How can I help?";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toBe("Hello! How can I help?");
  });

  test("detects assistant message by I'll keyword", () => {
    const input = "I'll help you with that task";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
  });

  test("detects assistant message by Let me keyword", () => {
    const input = "Let me check the code";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
  });

  test("parses conversation with multiple messages", () => {
    const input = "> Help me\nI'll help you\n> Thanks\nLet me continue";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.role).toBe("user");
    expect(messages[3]?.role).toBe("assistant");
  });

  test("includes tool uses in messages", () => {
    const input = "Let me read the file\nReading /path/to/file.ts";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolUses).toHaveLength(1);
    expect(messages[0]?.toolUses?.[0]?.name).toBe("Read");
  });

  test("extracts code blocks from messages", () => {
    const input = "Let me show you:\n```typescript\nconst x = 1;\n```";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.codeBlocks).toHaveLength(1);
    expect(messages[0]?.codeBlocks?.[0]?.language).toBe("typescript");
  });

  test("handles empty input", () => {
    expect(parseMessages("")).toEqual([]);
  });

  test("strips ANSI codes before parsing", () => {
    const input = "\u001B[32m> Hello\u001B[0m";
    const messages = parseMessages(input);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Hello");
  });
});

describe("MessageParser class", () => {
  test("parses incrementally added output", () => {
    const parser = new MessageParser();

    parser.addOutput("> Hello");
    expect(parser.getMessages()).toHaveLength(1);

    parser.addOutput("\nLet me help");
    expect(parser.getMessages()).toHaveLength(2);
  });

  test("clear resets the parser", () => {
    const parser = new MessageParser();
    parser.addOutput("> Hello");
    expect(parser.getMessages()).toHaveLength(1);

    parser.clear();
    expect(parser.getMessages()).toEqual([]);
  });

  test("getMessages returns parsed messages", () => {
    const parser = new MessageParser();
    parser.addOutput("> Test message");

    const messages = parser.getMessages();
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("Test message");
  });
});
