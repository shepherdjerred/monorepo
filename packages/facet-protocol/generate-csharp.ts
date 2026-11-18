import path from "node:path";

const GENERATOR_NAME = "facet-protocol";
const GENERATOR_VERSION = "0.1.0";

interface ProtocolUnitEnum {
  readonly name: string;
  readonly variants: readonly string[];
}

interface ProtocolTaggedVariant {
  readonly name: string;
  readonly payloadType: string;
}

interface ProtocolTaggedEnum {
  readonly name: string;
  readonly tagKey: string;
  readonly contentKey: string;
  readonly variants: readonly ProtocolTaggedVariant[];
}

interface ProtocolField {
  readonly rustName: string;
  readonly pascalName: string;
  readonly rustType: string;
  readonly csharpType: string;
  readonly optional: boolean;
}

interface ProtocolStruct {
  readonly name: string;
  readonly fields: readonly ProtocolField[];
}

export interface ProtocolSpec {
  readonly unitEnums: readonly ProtocolUnitEnum[];
  readonly taggedEnums: readonly ProtocolTaggedEnum[];
  readonly structs: readonly ProtocolStruct[];
}

interface RawDeclaration {
  readonly kind: "enum" | "struct";
  readonly name: string;
  readonly attributes: readonly string[];
  readonly body: string;
}

function stripRustComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < source.length) {
        const strCh = source[i]!;
        out += strCh;
        i += 1;
        if (strCh === "\\" && i < source.length) {
          out += source[i]!;
          i += 1;
          continue;
        }
        if (strCh === '"') {
          break;
        }
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        if (source[i] === "\n") {
          out += "\n";
        }
        i += 1;
      }
      if (i >= source.length) {
        throw new Error("Unterminated block comment in Rust protocol source.");
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

function skipWhitespace(source: string, start: number): number {
  let i = start;
  while (i < source.length && /\s/u.test(source[i]!)) {
    i += 1;
  }
  return i;
}

function readBalanced(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): { readonly content: string; readonly endIndex: number } {
  if (source[openIndex] !== openChar) {
    throw new Error(
      `Expected '${openChar}' at offset ${String(openIndex)}, found '${String(source[openIndex])}'.`,
    );
  }
  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (ch === '"') {
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, i),
          endIndex: i + 1,
        };
      }
    }
    i += 1;
  }
  throw new Error(
    `Unclosed '${openChar}' starting at offset ${String(openIndex)}.`,
  );
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === '"') {
      i += 1;
      while (i < input.length) {
        if (input[i] === "\\") {
          i += 2;
          continue;
        }
        if (input[i] === '"') {
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "<") angleDepth += 1;
    else if (ch === ">") angleDepth -= 1;
    else if (ch === "(") parenDepth += 1;
    else if (ch === ")") parenDepth -= 1;
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]") bracketDepth -= 1;
    else if (ch === "{") braceDepth += 1;
    else if (ch === "}") braceDepth -= 1;
    else if (
      ch === separator &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(input.slice(start));
  return parts;
}

function extractDeclarations(cleanSource: string): RawDeclaration[] {
  const declarations: RawDeclaration[] = [];
  let pendingAttributes: string[] = [];
  let i = 0;

  while (i < cleanSource.length) {
    i = skipWhitespace(cleanSource, i);
    if (i >= cleanSource.length) {
      break;
    }

    if (cleanSource.startsWith("use ", i)) {
      if (pendingAttributes.length > 0) {
        throw new Error(
          `Unexpected attributes before 'use' statement: ${pendingAttributes.join(", ")}`,
        );
      }
      const semi = cleanSource.indexOf(";", i);
      if (semi === -1) {
        throw new Error(
          "Unterminated 'use' statement in Rust protocol source.",
        );
      }
      i = semi + 1;
      continue;
    }

    if (cleanSource.startsWith("#[", i)) {
      const balanced = readBalanced(cleanSource, i + 1, "[", "]");
      pendingAttributes.push(balanced.content.trim());
      i = balanced.endIndex;
      continue;
    }

    const rest = cleanSource.slice(i);
    const declMatch =
      /^(?:pub\s+)?(enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/u.exec(rest);
    if (declMatch === null) {
      throw new Error(
        `Unexpected top-level Rust syntax near: "${rest.slice(0, 80).trim()}"`,
      );
    }

    const kind = declMatch[1] as "enum" | "struct";
    const name = declMatch[2]!;
    const openBraceOffset = i + declMatch[0].length - 1;
    const bodyBlock = readBalanced(cleanSource, openBraceOffset, "{", "}");

    declarations.push({
      kind,
      name,
      attributes: pendingAttributes,
      body: bodyBlock.content,
    });
    pendingAttributes = [];
    i = bodyBlock.endIndex;
  }

  if (pendingAttributes.length > 0) {
    throw new Error(
      `Dangling attributes at end of Rust protocol source: ${pendingAttributes.join(", ")}`,
    );
  }

  return declarations;
}

function inspectAttributes(
  itemName: string,
  attributes: readonly string[],
): {
  readonly hasTypeshare: boolean;
  readonly serdeAttributes: readonly string[];
} {
  let hasTypeshare = false;
  const serdeAttributes: string[] = [];

  for (const attr of attributes) {
    if (attr === "typeshare") {
      hasTypeshare = true;
      continue;
    }
    if (attr.startsWith("derive(") && attr.endsWith(")")) {
      continue;
    }
    if (attr.startsWith("serde(") && attr.endsWith(")")) {
      serdeAttributes.push(attr.slice("serde(".length, -1).trim());
      continue;
    }
    throw new Error(`Unhandled Rust attribute #[${attr}] on '${itemName}'.`);
  }

  return { hasTypeshare, serdeAttributes };
}

function parseTaggedSerdeConfig(
  enumName: string,
  serdeAttributes: readonly string[],
): { readonly tagKey: string; readonly contentKey: string } {
  if (serdeAttributes.length !== 1) {
    throw new Error(
      `Tagged enum '${enumName}' must carry exactly #[serde(tag = "type", content = "args")], got: ${JSON.stringify(serdeAttributes)}`,
    );
  }

  const entries = splitTopLevel(serdeAttributes[0]!, ",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let tagKey: string | undefined;
  let contentKey: string | undefined;

  for (const entry of entries) {
    const kv = /^([a-z_]+)\s*=\s*"([^"]+)"$/u.exec(entry);
    if (kv === null) {
      throw new Error(
        `Unhandled #[serde(${entry})] option on enum '${enumName}'.`,
      );
    }
    const key = kv[1]!;
    const val = kv[2]!;
    if (key === "tag") {
      tagKey = val;
    } else if (key === "content") {
      contentKey = val;
    } else {
      throw new Error(
        `Unhandled #[serde(${entry})] key '${key}' on enum '${enumName}'.`,
      );
    }
  }

  if (tagKey !== "type" || contentKey !== "args") {
    throw new Error(
      `Unsupported #[serde] representation on '${enumName}': expected tag="type", content="args", got tag=${String(tagKey)}, content=${String(contentKey)}.`,
    );
  }

  return { tagKey, contentKey };
}

function snakeToPascalCase(snake: string): string {
  return snake
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
}

function unwrapGeneric(rawType: string, wrapper: string): string | undefined {
  const prefix = `${wrapper}<`;
  if (!rawType.startsWith(prefix) || !rawType.endsWith(">")) {
    return undefined;
  }
  return rawType.slice(prefix.length, -1).trim();
}

function resolveNonOptionalCSharpType(
  rawType: string,
  knownTypes: ReadonlySet<string>,
  context: string,
): string {
  const trimmed = rawType.trim();

  if (trimmed === "String") return "string";
  if (trimmed === "bool") return "bool";
  if (trimmed === "f64") return "double";
  if (trimmed === "i32") return "int";

  if (unwrapGeneric(trimmed, "Option") !== undefined) {
    throw new Error(
      `Nested or unsupported Option placement '${trimmed}' at ${context}.`,
    );
  }

  const vecInner = unwrapGeneric(trimmed, "Vec");
  if (vecInner !== undefined) {
    const itemType = resolveNonOptionalCSharpType(
      vecInner,
      knownTypes,
      context,
    );
    return `IReadOnlyList<${itemType}>`;
  }

  const mapInner = unwrapGeneric(trimmed, "HashMap");
  if (mapInner !== undefined) {
    const args = splitTopLevel(mapInner, ",").map((part) => part.trim());
    if (args.length !== 2) {
      throw new Error(`Invalid HashMap type '${trimmed}' at ${context}.`);
    }
    if (args[0] !== "String") {
      throw new Error(
        `Unsupported HashMap key type '${String(args[0])}' at ${context}; only String keys are supported.`,
      );
    }
    const valueType = resolveNonOptionalCSharpType(
      args[1]!,
      knownTypes,
      context,
    );
    return `IReadOnlyDictionary<string, ${valueType}>`;
  }

  if (knownTypes.has(trimmed)) {
    return trimmed;
  }

  throw new Error(`Unrecognized Rust field type '${trimmed}' at ${context}.`);
}

function resolveFieldCSharpType(
  rawType: string,
  knownTypes: ReadonlySet<string>,
  context: string,
): { readonly csharpType: string; readonly optional: boolean } {
  const trimmed = rawType.trim();
  const optionInner = unwrapGeneric(trimmed, "Option");
  if (optionInner !== undefined) {
    const innerCSharp = resolveNonOptionalCSharpType(
      optionInner,
      knownTypes,
      context,
    );
    return {
      csharpType: `${innerCSharp}?`,
      optional: true,
    };
  }
  return {
    csharpType: resolveNonOptionalCSharpType(trimmed, knownTypes, context),
    optional: false,
  };
}

export function parseFacetProtocol(rustSource: string): ProtocolSpec {
  const clean = stripRustComments(rustSource);
  const rawDeclarations = extractDeclarations(clean);

  const typeshareDecls: Array<{
    readonly decl: RawDeclaration;
    readonly serdeAttributes: readonly string[];
  }> = [];
  const knownTypes = new Set<string>();

  for (const decl of rawDeclarations) {
    const { hasTypeshare, serdeAttributes } = inspectAttributes(
      decl.name,
      decl.attributes,
    );
    if (!hasTypeshare) {
      continue;
    }
    if (knownTypes.has(decl.name)) {
      throw new Error(`Duplicate #[typeshare] type '${decl.name}'.`);
    }
    knownTypes.add(decl.name);
    typeshareDecls.push({ decl, serdeAttributes });
  }

  const unitEnums: ProtocolUnitEnum[] = [];
  const taggedEnums: ProtocolTaggedEnum[] = [];
  const structs: ProtocolStruct[] = [];

  for (const { decl, serdeAttributes } of typeshareDecls) {
    if (decl.kind === "enum") {
      const rawVariants = splitTopLevel(decl.body, ",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      if (rawVariants.length === 0) {
        throw new Error(`Enum '${decl.name}' has no variants.`);
      }

      for (const entry of rawVariants) {
        if (entry.includes("#[")) {
          throw new Error(
            `Unhandled variant attribute in enum '${decl.name}': '${entry}'.`,
          );
        }
      }

      const isTupleVariant = rawVariants[0]!.includes("(");
      if (!isTupleVariant) {
        if (serdeAttributes.length > 0) {
          throw new Error(
            `Unhandled #[serde(${serdeAttributes.join(", ")})] on unit enum '${decl.name}'.`,
          );
        }
        const variants = rawVariants.map((entry) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry)) {
            throw new Error(
              `Unsupported variant '${entry}' in unit enum '${decl.name}'.`,
            );
          }
          return entry;
        });
        unitEnums.push({ name: decl.name, variants });
      } else {
        const { tagKey, contentKey } = parseTaggedSerdeConfig(
          decl.name,
          serdeAttributes,
        );
        const variants: ProtocolTaggedVariant[] = rawVariants.map((entry) => {
          const match =
            /^([A-Za-z_][A-Za-z0-9_]*)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/u.exec(
              entry,
            );
          if (match === null) {
            throw new Error(
              `Unsupported tagged enum variant '${entry}' in '${decl.name}'.`,
            );
          }
          const variantName = match[1]!;
          const payloadType = match[2]!;
          if (!knownTypes.has(payloadType)) {
            throw new Error(
              `Unrecognized payload type '${payloadType}' in '${decl.name}::${variantName}'.`,
            );
          }
          return { name: variantName, payloadType };
        });
        taggedEnums.push({
          name: decl.name,
          tagKey,
          contentKey,
          variants,
        });
      }
      continue;
    }

    if (serdeAttributes.length > 0) {
      throw new Error(
        `Unhandled #[serde(${serdeAttributes.join(", ")})] on struct '${decl.name}'.`,
      );
    }

    const rawFields = splitTopLevel(decl.body, ",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const fields: ProtocolField[] = rawFields.map((entry) => {
      if (entry.includes("#[")) {
        throw new Error(
          `Unhandled field attribute in struct '${decl.name}': '${entry}'.`,
        );
      }
      const fieldMatch = /^pub\s+([a-z][a-z0-9_]*)\s*:\s*(.+)$/su.exec(entry);
      if (fieldMatch === null) {
        throw new Error(
          `Invalid field declaration '${entry}' in struct '${decl.name}'.`,
        );
      }
      const rustName = fieldMatch[1]!;
      const rustType = fieldMatch[2]!.trim();
      const pascalName = snakeToPascalCase(rustName);
      if (pascalName === decl.name) {
        throw new Error(
          `Property '${pascalName}' collides with enclosing record name '${decl.name}'.`,
        );
      }
      const { csharpType, optional } = resolveFieldCSharpType(
        rustType,
        knownTypes,
        `${decl.name}.${rustName}`,
      );
      return {
        rustName,
        pascalName,
        rustType,
        csharpType,
        optional,
      };
    });

    structs.push({ name: decl.name, fields });
  }

  return { unitEnums, taggedEnums, structs };
}

function renderUnitEnum(unitEnum: ProtocolUnitEnum): string {
  const variantLines = unitEnum.variants
    .map((v) => `    /// <summary>${unitEnum.name}.${v}.</summary>\n    ${v},`)
    .join("\n");
  return `/// <summary>Generated protocol enum ${unitEnum.name}.</summary>
[GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]
[JsonConverter(typeof(JsonStringEnumConverter<${unitEnum.name}>))]
public enum ${unitEnum.name}
{
${variantLines}
}`;
}

function renderStruct(structDef: ProtocolStruct): string {
  let lastRequiredIndex = -1;
  for (let i = 0; i < structDef.fields.length; i += 1) {
    if (!structDef.fields[i]!.optional) {
      lastRequiredIndex = i;
    }
  }

  const paramDocLines = structDef.fields.map(
    (field) =>
      `/// <param name="${field.pascalName}">Wire field <c>${field.rustName}</c>.</param>`,
  );

  const paramLines = structDef.fields.map((field, index) => {
    const comma = index < structDef.fields.length - 1 ? "," : "";
    if (field.optional) {
      const defaultSuffix = index > lastRequiredIndex ? " = null" : "";
      return `    [property: JsonPropertyName("${field.rustName}")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ${field.csharpType} ${field.pascalName}${defaultSuffix}${comma}`;
    }
    return `    [property: JsonPropertyName("${field.rustName}")] ${field.csharpType} ${field.pascalName}${comma}`;
  });

  return `/// <summary>Generated protocol record ${structDef.name}.</summary>
${paramDocLines.join("\n")}
[GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]
public sealed record ${structDef.name}(
${paramLines.join("\n")}
);`;
}

function renderTaggedEnum(taggedEnum: ProtocolTaggedEnum): string {
  const converterName = `${taggedEnum.name}JsonConverter`;
  const variantRecords = taggedEnum.variants
    .map(
      (variant) =>
        `    /// <summary>${taggedEnum.name} variant ${variant.name}.</summary>\n    /// <param name="Args">Command arguments payload.</param>\n    [GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]\n    public sealed record ${variant.name}(${variant.payloadType} Args) : ${taggedEnum.name};`,
    )
    .join("\n\n");

  const readArms = taggedEnum.variants
    .map(
      (variant) =>
        `            "${variant.name}" => new ${taggedEnum.name}.${variant.name}(\n                DeserializeArgs<${variant.payloadType}>(argsElement, commandType, options)\n            ),`,
    )
    .join("\n");

  const writeCases = taggedEnum.variants
    .map(
      (variant) => `            case ${taggedEnum.name}.${variant.name} variant:
                writer.WriteString("${taggedEnum.tagKey}", "${variant.name}");
                writer.WritePropertyName("${taggedEnum.contentKey}");
                JsonSerializer.Serialize(writer, variant.Args, options);
                break;`,
    )
    .join("\n");

  return `/// <summary>Generated protocol discriminated union ${taggedEnum.name}.</summary>
[GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]
[JsonConverter(typeof(${converterName}))]
public abstract record ${taggedEnum.name}
{
    private ${taggedEnum.name}() { }

${variantRecords}
}

/// <summary>JSON converter for <see cref="${taggedEnum.name}"/>.</summary>
[GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]
public sealed class ${converterName} : JsonConverter<${taggedEnum.name}>
{
    /// <inheritdoc />
    public override ${taggedEnum.name} Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    )
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException("Expected StartObject token for ${taggedEnum.name}.");
        }

        using var document = JsonDocument.ParseValue(ref reader);
        var root = document.RootElement;

        if (
            !root.TryGetProperty("${taggedEnum.tagKey}", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String
        )
        {
            throw new JsonException(
                "${taggedEnum.name} is missing required string property '${taggedEnum.tagKey}'."
            );
        }

        var commandType =
            typeElement.GetString()
            ?? throw new JsonException(
                "${taggedEnum.name} property '${taggedEnum.tagKey}' cannot be null."
            );

        if (
            !root.TryGetProperty("${taggedEnum.contentKey}", out var argsElement)
            || argsElement.ValueKind != JsonValueKind.Object
        )
        {
            throw new JsonException(
                $"${taggedEnum.name} '{commandType}' is missing required object property '${taggedEnum.contentKey}'."
            );
        }

        return commandType switch
        {
${readArms}
            _ => throw new JsonException($"Unknown ${taggedEnum.name} ${taggedEnum.tagKey} '{commandType}'."),
        };
    }

    /// <inheritdoc />
    public override void Write(
        Utf8JsonWriter writer,
        ${taggedEnum.name} value,
        JsonSerializerOptions options
    )
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(value);

        writer.WriteStartObject();
        switch (value)
        {
${writeCases}
            default:
                throw new JsonException(
                    $"Unsupported ${taggedEnum.name} variant '{value.GetType().Name}'."
                );
        }
        writer.WriteEndObject();
    }

    private static TArgs DeserializeArgs<TArgs>(
        JsonElement argsElement,
        string commandType,
        JsonSerializerOptions options
    )
    {
        return argsElement.Deserialize<TArgs>(options)
            ?? throw new JsonException(
                $"${taggedEnum.name} '{commandType}' property '${taggedEnum.contentKey}' deserialized to null."
            );
    }
}`;
}

function renderFacetProtocolCSharp(spec: ProtocolSpec): string {
  const sections: string[] = [
    `// <auto-generated />
#nullable enable

using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaskNotes.Protocol;`,
  ];

  for (const unitEnum of spec.unitEnums) {
    sections.push(renderUnitEnum(unitEnum));
  }

  for (const structDef of spec.structs) {
    sections.push(renderStruct(structDef));
  }

  for (const taggedEnum of spec.taggedEnums) {
    sections.push(renderTaggedEnum(taggedEnum));
  }

  sections.push(`/// <summary>Shared JSON serializer configuration for Facet protocol types.</summary>
[GeneratedCode("${GENERATOR_NAME}", "${GENERATOR_VERSION}")]
public static class FacetProtocolJson
{
    /// <summary>Default serializer options omitting null optional properties.</summary>
    public static JsonSerializerOptions Options { get; } =
        new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
}`);

  return `${sections.join("\n\n")}\n`;
}

export async function writeFileIfChanged(
  filePath: string,
  content: string,
): Promise<boolean> {
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const existing = await file.text();
    if (existing === content) {
      return false;
    }
  }
  await Bun.write(filePath, content);
  return true;
}

export async function generateCSharp(protocolDir: string): Promise<{
  readonly outputPath: string;
  readonly spec: ProtocolSpec;
  readonly updated: boolean;
}> {
  const rustPath = path.join(protocolDir, "src/lib.rs");
  const rustSource = await Bun.file(rustPath).text();
  const spec = parseFacetProtocol(rustSource);
  const csharpContent = renderFacetProtocolCSharp(spec);
  const outputPath = path.join(protocolDir, "generated/FacetProtocol.cs");
  const updated = await writeFileIfChanged(outputPath, csharpContent);
  return { outputPath, spec, updated };
}
