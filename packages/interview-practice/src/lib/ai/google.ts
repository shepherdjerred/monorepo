import { z } from "zod/v4";
import type {
  FunctionDeclaration,
  FunctionDeclarationSchemaProperty,
  SchemaType,
  SimpleStringSchema,
} from "@google/generative-ai";
import type { AIClient } from "./client.ts";

const FunctionCallPartSchema = z.object({
  functionCall: z.object({
    name: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
});

const PropertySchema = z.object({
  type: z.string().optional(),
  description: z.string().optional(),
});

const InputSchemaPropertiesSchema = z.record(z.string(), PropertySchema);
const InputSchemaRequiredSchema = z.array(z.string());

type ToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown> };

export function createGoogleClient(
  model: string,
  apiKey: string | undefined,
): AIClient {
  return {
    async chat(options) {
      const { GoogleGenerativeAI, SchemaType } = await import(
        "@google/generative-ai"
      );

      if (apiKey === undefined) {
        throw new Error("GOOGLE_API_KEY is required for the Google provider");
      }

      const genAI = new GoogleGenerativeAI(apiKey);

      const functionDeclarations: FunctionDeclaration[] | undefined =
        options.tools && options.tools.length > 0
          ? buildFunctionDeclarations(options.tools, SchemaType.OBJECT, SchemaType.STRING)
          : undefined;

      const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: options.systemPrompt,
        ...(functionDeclarations === undefined
          ? {}
          : { tools: [{ functionDeclarations }] }),
      });

      const contents = options.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          {
            text:
              m.role === "system"
                ? `[System context] ${m.content}`
                : m.content,
          },
        ],
      }));

      const result = await genModel.generateContent({ contents });
      const response = result.response;
      const candidate = response.candidates?.[0];

      if (candidate === undefined) {
        return {
          text: "",
          toolCalls: [],
          tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
          stopReason: "error",
        };
      }

      const textParts = candidate.content.parts.filter(
        (p) => "text" in p && typeof p.text === "string",
      );
      const functionCallParts = candidate.content.parts.filter(
        (p) => "functionCall" in p,
      );

      const text = textParts
        .map((p) => ("text" in p ? p.text : ""))
        .join("");

      const toolCalls = functionCallParts.map((p, i) => {
        const validated = FunctionCallPartSchema.parse(p);
        return {
          id: `google-fc-${String(i)}`,
          name: validated.functionCall.name,
          input: validated.functionCall.args ?? {},
        };
      });

      return {
        text,
        toolCalls,
        tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
        stopReason: candidate.finishReason ?? "STOP",
      };
    },
  };
}

function buildFunctionDeclarations(
  tools: ToolDefinition[],
  objectType: SchemaType.OBJECT,
  stringType: SchemaType.STRING,
): FunctionDeclaration[] {
  return tools.map((t) => {
    const rawProps = t.inputSchema["properties"] ?? {};
    const props = InputSchemaPropertiesSchema.parse(rawProps);
    const required = InputSchemaRequiredSchema.parse(
      t.inputSchema["required"] ?? [],
    );

    const properties: Record<string, FunctionDeclarationSchemaProperty> = {};
    for (const [k, v] of Object.entries(props)) {
      // All our tool parameters are strings; build SimpleStringSchema objects
      const prop: SimpleStringSchema = v.description === undefined
        ? { type: stringType }
        : { type: stringType, description: v.description };
      properties[k] = prop;
    }

    return {
      name: t.name,
      description: t.description,
      parameters: {
        type: objectType,
        properties,
        required,
      },
    };
  });
}
