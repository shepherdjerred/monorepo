import { describe, test, expect } from "bun:test";
import {
  DiscordConfigSchema,
  OpenAIConfigSchema,
  MastraConfigSchema,
  TelemetryConfigSchema,
  DailyPostsConfigSchema,
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

describe("OpenAIConfigSchema", () => {
  test("validates with defaults", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("gpt-5-mini");
      expect(result.data.classifierModel).toBe("gpt-5-nano");
      expect(result.data.maxTokens).toBe(4096);
    }
  });

  test("allows custom model and classifierModel", () => {
    const result = OpenAIConfigSchema.safeParse({
      apiKey: "test-key",
      model: "gpt-4o",
      classifierModel: "gpt-4o-mini",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("gpt-4o");
      expect(result.data.classifierModel).toBe("gpt-4o-mini");
    }
  });

  test("rejects missing apiKey", () => {
    const result = OpenAIConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("MastraConfigSchema", () => {
  test("uses defaults", () => {
    const result = MastraConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memoryDbPath).toBe("file:/app/data/mastra-memory.db");
      expect(result.data.studioEnabled).toBe(true);
      expect(result.data.studioPort).toBe(4111);
      expect(result.data.studioHost).toBe("0.0.0.0");
    }
  });

  test("allows custom values", () => {
    const result = MastraConfigSchema.safeParse({
      memoryDbPath: "file:/custom/path/memory.db",
      studioEnabled: false,
      studioPort: 8080,
      studioHost: "127.0.0.1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memoryDbPath).toBe("file:/custom/path/memory.db");
      expect(result.data.studioEnabled).toBe(false);
      expect(result.data.studioPort).toBe(8080);
      expect(result.data.studioHost).toBe("127.0.0.1");
    }
  });
});

describe("TelemetryConfigSchema", () => {
  test("uses defaults", () => {
    const result = TelemetryConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.otlpEndpoint).toBe(
        "http://tempo.monitoring.svc.cluster.local:4318"
      );
      expect(result.data.serviceName).toBe("birmel");
    }
  });

  test("allows custom values", () => {
    const result = TelemetryConfigSchema.safeParse({
      enabled: false,
      otlpEndpoint: "http://localhost:4318",
      serviceName: "birmel-dev",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.otlpEndpoint).toBe("http://localhost:4318");
      expect(result.data.serviceName).toBe("birmel-dev");
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
      openai: {
        apiKey: "test-openai-key",
      },
      mastra: {},
      telemetry: {},
      dailyPosts: {},
      externalApis: {},
      logging: {},
      sentry: {},
      persona: {},
      birthdays: {},
      activityTracking: {},
      shell: {},
      scheduler: {},
      browser: {},
      elections: {},
    });
    expect(result.success).toBe(true);
  });

  test("rejects config with missing required section", () => {
    const result = ConfigSchema.safeParse({
      openai: {
        apiKey: "test-openai-key",
      },
    });
    expect(result.success).toBe(false);
  });
});
