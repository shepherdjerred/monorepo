import type { TypeScriptInterface } from "./types.ts";
import {
  StringSchema,
  ArraySchema,
  RecordSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
} from "./schemas.ts";
import { capitalizeFirst } from "./utils.ts";

/**
 * Generate TypeScript code from interface definition
 */
export function generateTypeScriptCode(
  mainInterface: TypeScriptInterface,
  chartName: string,
): string {
  const interfaces: TypeScriptInterface[] = [];

  // Collect all nested interfaces
  collectNestedInterfaces(mainInterface, interfaces);

  let code = `// Generated TypeScript types for ${chartName} Helm chart\n\n`;

  // Generate all interfaces
  for (const iface of interfaces) {
    code += generateInterfaceCode(iface);
    code += "\n";
  }

  // Generate parameter type (flattened dot notation)
  code += generateParameterType(mainInterface, chartName);

  // Add header comment for generated files
  if (code.includes(": any")) {
    code = `// Generated TypeScript types for ${chartName} Helm chart

${code.slice(Math.max(0, code.indexOf("\n\n") + 2))}`;
  }

  return code;
}

function collectNestedInterfaces(
  iface: TypeScriptInterface,
  collected: TypeScriptInterface[],
): void {
  for (const prop of Object.values(iface.properties)) {
    if (prop.nested) {
      collected.push(prop.nested);
      collectNestedInterfaces(prop.nested, collected);
    }
  }

  // Add main interface last so dependencies come first
  if (!collected.some((i) => i.name === iface.name)) {
    collected.push(iface);
  }
}

function generateInterfaceCode(iface: TypeScriptInterface): string {
  const hasProperties = Object.keys(iface.properties).length > 0;

  if (!hasProperties) {
    // Use 'object' for empty interfaces instead of '{}'
    return `export type ${iface.name} = object;\n`;
  }

  let code = `export type ${iface.name} = {\n`;

  for (const [key, prop] of Object.entries(iface.properties)) {
    const optional = prop.optional ? "?" : "";

    // Generate JSDoc comment if we have description or default
    if (prop.description != null && prop.description !== "" || prop.default !== undefined) {
      code += `  /**\n`;

      if (prop.description != null && prop.description !== "") {
        // Format multi-line descriptions properly with " * " prefix
        // Escape */ sequences to prevent premature comment closure
        const escapedDescription = prop.description.replaceAll(
          "*/",
          String.raw`*\/`,
        );
        const descLines = escapedDescription.split("\n");
        for (const line of descLines) {
          code += `   * ${line}\n`;
        }
      }

      if (prop.default !== undefined) {
        const defaultStr = formatDefaultValue(prop.default);
        const hasDescription = prop.description != null && prop.description !== "";
        if (defaultStr != null && defaultStr !== "" && hasDescription) {
          code += `   *\n`;
        }
        if (defaultStr != null && defaultStr !== "") {
          code += `   * @default ${defaultStr}\n`;
        }
      }

      code += `   */\n`;
    }

    code += `  ${key}${optional}: ${prop.type};\n`;
  }

  code += "};\n";
  return code;
}

/**
 * Format a default value for display in JSDoc
 */
function formatDefaultValue(value: unknown): string | null {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return null;
  }

  // Handle arrays
  const arrayCheck = ArraySchema.safeParse(value);
  if (arrayCheck.success) {
    if (arrayCheck.data.length === 0) {
      return "[]";
    }
    if (arrayCheck.data.length <= 3) {
      try {
        return JSON.stringify(arrayCheck.data);
      } catch {
        return "[...]";
      }
    }
    return `[...] (${String(arrayCheck.data.length)} items)`;
  }

  // Handle objects
  const recordCheck = RecordSchema.safeParse(value);
  if (recordCheck.success) {
    const keys = Object.keys(recordCheck.data);
    if (keys.length === 0) {
      return "{}";
    }
    if (keys.length <= 3) {
      try {
        return JSON.stringify(recordCheck.data);
      } catch {
        return "{...}";
      }
    }
    return `{...} (${String(keys.length)} keys)`;
  }

  // Primitives
  const stringCheck = StringSchema.safeParse(value);
  if (stringCheck.success) {
    // Truncate long strings
    if (stringCheck.data.length > 50) {
      return `"${stringCheck.data.slice(0, 47)}..."`;
    }
    return `"${stringCheck.data}"`;
  }

  // Handle other primitives (numbers, booleans, etc.)
  const numberCheck = ActualNumberSchema.safeParse(value);
  if (numberCheck.success) {
    return String(numberCheck.data);
  }

  const booleanCheck = ActualBooleanSchema.safeParse(value);
  if (booleanCheck.success) {
    return String(booleanCheck.data);
  }

  // Fallback for unknown types - try JSON.stringify
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown";
  }
}

function generateParameterType(
  iface: TypeScriptInterface,
  chartName: string,
): string {
  const parameterKeys = flattenInterfaceKeys(iface);

  const normalizedChartName = capitalizeFirst(chartName).replaceAll("-", "");
  let code = `export type ${normalizedChartName}HelmParameters = {\n`;

  for (const key of parameterKeys) {
    code += `  "${key}"?: string;\n`;
  }

  code += "};\n";

  return code;
}

function flattenInterfaceKeys(
  iface: TypeScriptInterface,
  prefix = "",
): string[] {
  const keys: string[] = [];

  for (const [key, prop] of Object.entries(iface.properties)) {
    // Remove quotes from key for parameter names
    const cleanKey = key.replaceAll('"', "");
    const fullKey = prefix ? `${prefix}.${cleanKey}` : cleanKey;

    if (prop.nested) {
      keys.push(...flattenInterfaceKeys(prop.nested, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}
