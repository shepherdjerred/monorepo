import { describe, test, expect } from "bun:test";
import {
  DiscordConfigSchema,
  AnthropicConfigSchema,
  OpenAIConfigSchema,
  DatabaseConfigSchema,
  DailyPostsConfigSchema,
  VoiceConfigSchema,
  ExternalApisSchema,
  LoggingConfigSchema,
  ConfigSchema,
} from "../../src/config/schema.js";

describe("DiscordConfigSchema", () => {
  test("validates valid config", () => {
    const result = DiscordConfigSchema.safeParse({
      token: "test-token",
      clientId: "test-client-id",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing token", () => {
    const result = DiscordConfigSchema.safeParse({
      clientId: "test-client-id",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty token", () => {
    const result = DiscordConfigSchema.safeParse({
      token: "",
      clientId: "test-client-id",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing clientId", () => {
    const result = DiscordConfigSchema.safeParse({
      token: "test-token",
    });
    expect(result.success).toBe(false);
  });
});

describe("AnthropicConfigSchema", () => {
  test("validates with required fields only", () => {
    const result = AnthropicConfigSchema.safeParse({
      apiKey: "test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("claude-sonnet-4-20250514");
      expect(result.data.maxTokens).toBe(4096);
    }
  });

  test("allows custom model and maxTokens", () => {
    const result = AnthropicConfigSchema.safeParse({
      apiKey: "test-key",
      model: "claude-opus-4-20250514",
      maxTokens: 8192,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("claude-opus-4-20250514");
      expect(result.data.maxTokens).toBe(8192);
    }
  });

  test("rejects missing apiKey", () => {
    const result = AnthropicConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("OpenAIConfigSchema", () => {
  test("validates with defaults", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whisperModel).toBe("whisper-1");
      expect(result.data.ttsModel).toBe("tts-1");
      expect(result.data.ttsVoice).toBe("nova");
      expect(result.data.ttsSpeed).toBe(1.0);
    }
  });

  test("validates all voice options", () => {
    const voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
    for (const voice of voices) {
      const result = OpenAIConfigSchema.safeParse({
        apiKey: "test-key",
        ttsVoice: voice,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid voice", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
      ttsVoice: "invalid-voice",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ttsSpeed below minimum", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
      ttsSpeed: 0.1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects ttsSpeed above maximum", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
      ttsSpeed: 5.0,
    });
    expect(result.success).toBe(false);
  });
});

describe("DatabaseConfigSchema", () => {
  test("uses default path", () => {
    const result = DatabaseConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("./data/birmel.db");
    }
  });

  test("allows custom path", () => {
    const result = DatabaseConfigSchema.safeParse({
      path: "/custom/path/db.sqlite",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("/custom/path/db.sqlite");
    }
  });
});

describe("DailyPostsConfigSchema", () => {
  test("uses defaults", () => {
    const result = DailyPostsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.time).toBe("09:00");
      expect(result.data.timezone).toBe("America/Los_Angeles");
    }
  });

  test("validates HH:MM time format", () => {
    const result = DailyPostsConfigSchema.safeParse({
      time: "14:30",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid time format", () => {
    const result = DailyPostsConfigSchema.safeParse({
      time: "9:00",
    });
    expect(result.success).toBe(false);
  });

  test("rejects time with seconds", () => {
    const result = DailyPostsConfigSchema.safeParse({
      time: "09:00:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("VoiceConfigSchema", () => {
  test("uses defaults", () => {
    const result = VoiceConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.silenceThresholdMs).toBe(1500);
      expect(result.data.maxRecordingMs).toBe(30000);
    }
  });

  test("allows custom values", () => {
    const result = VoiceConfigSchema.safeParse({
      enabled: false,
      silenceThresholdMs: 2000,
      maxRecordingMs: 60000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.silenceThresholdMs).toBe(2000);
      expect(result.data.maxRecordingMs).toBe(60000);
    }
  });
});

describe("ExternalApisSchema", () => {
  test("allows empty config", () => {
    const result = ExternalApisSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("allows optional API keys", () => {
    const result = ExternalApisSchema.safeParse({
      newsApiKey: "news-key",
      riotApiKey: "riot-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newsApiKey).toBe("news-key");
      expect(result.data.riotApiKey).toBe("riot-key");
    }
  });
});

describe("LoggingConfigSchema", () => {
  test("uses default level", () => {
    const result = LoggingConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe("info");
    }
  });

  test("validates all log levels", () => {
    const levels = ["debug", "info", "warn", "error"] as const;
    for (const level of levels) {
      const result = LoggingConfigSchema.safeParse({ level });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid log level", () => {
    const result = LoggingConfigSchema.safeParse({
      level: "verbose",
    });
    expect(result.success).toBe(false);
  });
});

describe("ConfigSchema (full)", () => {
  test("validates complete config with all required fields", () => {
    const result = ConfigSchema.safeParse({
      discord: {
        token: "test-token",
        clientId: "test-client-id",
      },
      anthropic: {
        apiKey: "test-anthropic-key",
      },
      openai: {
        apiKey: "test-openai-key",
      },
      database: {},
      dailyPosts: {},
      voice: {},
      externalApis: {},
      logging: {},
    });
    expect(result.success).toBe(true);
  });

  test("rejects config with missing required section", () => {
    const result = ConfigSchema.safeParse({
      anthropic: {
        apiKey: "test-anthropic-key",
      },
      openai: {
        apiKey: "test-openai-key",
      },
    });
    expect(result.success).toBe(false);
  });
});
