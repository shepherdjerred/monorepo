export interface User {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
}

export interface Session {
  id: string;
  repoUrl: string;
  branch: string;
  status: "pending" | "running" | "stopped";
  createdAt: string;
  updatedAt: string;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  timestamp: number;
}

// WebSocket message types
export interface PromptMessage {
  type: "prompt";
  content: string;
}

export interface InterruptMessage {
  type: "interrupt";
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = PromptMessage | InterruptMessage | PingMessage;

export interface AssistantMessage {
  type: "assistant";
  content: ContentBlock[];
}

export interface ResultMessage {
  type: "result";
  subtype: "success" | "error";
  result?: string;
  error?: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | AssistantMessage
  | ResultMessage
  | ErrorMessage
  | PongMessage;
