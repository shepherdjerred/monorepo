import path from "node:path";
import type { FunctionSignature } from "./schemas.ts";

const TEMPLATES_DIR = path.join(
  path.dirname(import.meta.dir),
  "..",
  "templates",
);

export async function generateStarterCode(
  language: string,
  signature: FunctionSignature,
  problemTitle: string,
): Promise<string> {
  const ext = language.startsWith(".") ? language : `.${language}`;
  const templateName = getTemplateName(ext);
  const templatePath = path.join(TEMPLATES_DIR, templateName);

  try {
    let template = await Bun.file(templatePath).text();
    template = template.replaceAll("{{TITLE}}", problemTitle);
    template = template.replaceAll("{{FUNCTION_NAME}}", signature.name);
    template = template.replaceAll("{{PARAMS}}", buildParams(ext, signature));
    template = template.replaceAll("{{RETURN_TYPE}}", signature.returnType);
    template = template.replaceAll(
      "{{DEFAULT_RETURN}}",
      getDefaultReturn(ext, signature.returnType),
    );
    return template;
  } catch {
    return getDefaultTemplate(ext, signature, problemTitle);
  }
}

function buildParams(ext: string, signature: FunctionSignature): string {
  switch (ext) {
    case ".ts":
      return signature.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    case ".java":
      return signature.params
        .map((p) => `${toJavaType(p.type)} ${p.name}`)
        .join(", ");
    case ".py":
      return signature.params.map((p) => p.name).join(", ");
    case ".go":
      return signature.params
        .map((p) => `${p.name} ${toGoType(p.type)}`)
        .join(", ");
    default:
      return signature.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  }
}

function toJavaType(tsType: string): string {
  const map: Record<string, string> = {
    number: "int",
    "number[]": "int[]",
    "number[][]": "int[][]",
    string: "String",
    "string[]": "String[]",
    boolean: "boolean",
    "boolean[]": "boolean[]",
  };
  return map[tsType] ?? tsType;
}

function toGoType(tsType: string): string {
  const map: Record<string, string> = {
    number: "int",
    "number[]": "[]int",
    "number[][]": "[][]int",
    string: "string",
    "string[]": "[]string",
    boolean: "bool",
    "boolean[]": "[]bool",
  };
  return map[tsType] ?? tsType;
}

function getDefaultReturn(ext: string, returnType: string): string {
  const isArray = returnType.includes("[]");
  const isBool = returnType === "boolean";
  const isString = returnType === "string";
  const isNumber = returnType === "number";

  switch (ext) {
    case ".ts":
      if (isArray) return "[]";
      if (isBool) return "false";
      if (isString) return '""';
      if (isNumber) return "0";
      return "undefined";
    case ".java":
      if (isArray) return `new ${toJavaType(returnType)}{}`;
      if (isBool) return "false";
      if (isString) return '""';
      return "0";
    case ".py":
      if (isArray) return "[]";
      if (isBool) return "False";
      if (isString) return '""';
      if (isNumber) return "0";
      return "None";
    case ".go":
      if (isArray) return "nil";
      if (isBool) return "false";
      if (isString) return '""';
      return "0";
    default:
      return "undefined";
  }
}

function getTemplateName(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript.ts.template",
    ".java": "java.java.template",
    ".py": "python.py.template",
    ".go": "go.go.template",
    ".rs": "rust.rs.template",
    ".cpp": "cpp.cpp.template",
  };
  return map[ext] ?? "typescript.ts.template";
}

function getDefaultTemplate(
  ext: string,
  signature: FunctionSignature,
  title: string,
): string {
  const params = buildParams(ext, signature);
  switch (ext) {
    case ".ts":
      return `// ${title}

export function ${signature.name}(${params}): ${signature.returnType} {
  // TODO: implement
  return ${getDefaultReturn(ext, signature.returnType)};
}
`;
    case ".java":
      return `// ${title}

public class Solution {
    public ${toJavaType(signature.returnType)} ${signature.name}(${params}) {
        // TODO: implement
        return ${getDefaultReturn(ext, signature.returnType)};
    }
}
`;
    case ".py":
      return `# ${title}

def ${toSnakeCase(signature.name)}(${params}):
    # TODO: implement
    return ${getDefaultReturn(ext, signature.returnType)}
`;
    default:
      return `// ${title}\n// TODO: implement\n`;
  }
}

function toSnakeCase(name: string): string {
  return name.replaceAll(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function getFileExtension(language: string): string {
  const map: Record<string, string> = {
    ts: ".ts",
    typescript: ".ts",
    java: ".java",
    py: ".py",
    python: ".py",
    go: ".go",
    rs: ".rs",
    rust: ".rs",
    cpp: ".cpp",
    "c++": ".cpp",
    c: ".c",
  };
  const lower = language.toLowerCase();
  return map[lower] ?? `.${lower}`;
}

export function getSolutionFilename(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "solution.ts",
    ".java": "Solution.java",
    ".py": "solution.py",
    ".go": "solution.go",
    ".rs": "solution.rs",
    ".cpp": "solution.cpp",
    ".c": "solution.c",
  };
  return map[ext] ?? `solution${ext}`;
}
