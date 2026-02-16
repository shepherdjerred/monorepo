import type { TypeScriptInterface } from "./types.js";
import { ArraySchema, RecordSchema, StringSchema, ActualNumberSchema, ActualBooleanSchema } from "./schemas.js";

/**
 * Generate TypeScript code from interface definition
 */
export function generateTypeScriptCode(mainInterface: TypeScriptInterface, chartName: string): string {
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

  // Check if any 'any' types were generated and add ESLint disable if needed
  if (code.includes(": any")) {
    code = `// Generated TypeScript types for ${chartName} Helm chart
/* eslint-disable @typescript-eslint/no-explicit-any */

${code.substring(code.indexOf("\n\n") + 2)}`;
  }

  return code;
}

function collectNestedInterfaces(iface: TypeScriptInterface, collected: TypeScriptInterface[]): void {
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

  if (!hasProperties && !iface.allowArbitraryProps) {
    // Use 'object' for empty interfaces instead of '{}'
    return `export type ${iface.name} = object;\n`;
  }

  let code = `export type ${iface.name} = {\n`;

  // Add index signature if this type allows arbitrary properties
  if (iface.allowArbitraryProps) {
    code += `  /**\n`;
    code += `   * This type allows arbitrary additional properties beyond those defined below.\n`;
    code += `   * This is common for config maps, custom settings, and extensible configurations.\n`;
    code += `   */\n`;
    code += `  [key: string]: unknown;\n`;
  }

  for (const [key, prop] of Object.entries(iface.properties)) {
    const optional = prop.optional ? "?" : "";

    // Generate JSDoc comment if we have description or default
    if (prop.description || prop.default !== undefined) {
      code += `  /**\n`;

      if (prop.description) {
        // Format multi-line descriptions properly with " * " prefix
        // Escape */ sequences to prevent premature comment closure
        const escapedDescription = prop.description.replace(/\*\//g, "*\\/");
        const descLines = escapedDescription.split("\n");
        for (const line of descLines) {
          code += `   * ${line}\n`;
        }
      }

      if (prop.default !== undefined) {
        const defaultStr = formatDefaultValue(prop.default);
        if (defaultStr) {
          if (prop.description) code += `   *\n`;
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
  if (value === null) return "null";
  if (value === undefined) return null;

  // Handle arrays
  const arrayCheck = ArraySchema.safeParse(value);
  if (arrayCheck.success) {
    if (arrayCheck.data.length === 0) return "[]";
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
    if (keys.length === 0) return "{}";
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
      return `"${stringCheck.data.substring(0, 47)}..."`;
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

function generateParameterType(iface: TypeScriptInterface, chartName: string): string {
  const parameterKeys = flattenInterfaceKeys(iface);

  const normalizedChartName = capitalizeFirst(chartName).replace(/-/g, "");
  let code = `export type ${normalizedChartName}HelmParameters = {\n`;

  for (const key of parameterKeys) {
    code += `  "${key}"?: string;\n`;
  }

  code += "};\n";

  return code;
}

function flattenInterfaceKeys(iface: TypeScriptInterface, prefix = ""): string[] {
  const keys: string[] = [];

  for (const [key, prop] of Object.entries(iface.properties)) {
    // Remove quotes from key for parameter names
    const cleanKey = key.replace(/"/g, "");
    const fullKey = prefix ? `${prefix}.${cleanKey}` : cleanKey;

    if (prop.nested) {
      keys.push(...flattenInterfaceKeys(prop.nested, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
