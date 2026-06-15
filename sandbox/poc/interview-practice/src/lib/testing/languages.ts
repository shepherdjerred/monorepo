export type LanguageConfig = {
  compile: string | null;
  run: string;
  compileTimeout: number;
  runTimeout: number;
};

const LANGUAGES: Record<string, LanguageConfig> = {
  ".ts": {
    compile: null,
    run: "bun run {file}",
    compileTimeout: 0,
    runTimeout: 5000,
  },
  ".java": {
    compile: "javac {file}",
    run: "java -cp {dir} Solution",
    compileTimeout: 15_000,
    runTimeout: 8000,
  },
  ".py": {
    compile: null,
    run: "python3 {file}",
    compileTimeout: 0,
    runTimeout: 5000,
  },
  ".go": {
    compile: null,
    run: "go run {file}",
    compileTimeout: 0,
    runTimeout: 8000,
  },
  ".rs": {
    compile: "rustc {file} -o {dir}/sol -C edition=2021",
    run: "{dir}/sol",
    compileTimeout: 15_000,
    runTimeout: 5000,
  },
  ".cpp": {
    compile: "g++ {file} -o {dir}/sol -std=c++17",
    run: "{dir}/sol",
    compileTimeout: 15_000,
    runTimeout: 5000,
  },
  ".c": {
    compile: "gcc {file} -o {dir}/sol",
    run: "{dir}/sol",
    compileTimeout: 15_000,
    runTimeout: 5000,
  },
};

export function getLanguageConfig(ext: string): LanguageConfig | undefined {
  return LANGUAGES[ext];
}

export function getSupportedExtensions(): string[] {
  return Object.keys(LANGUAGES);
}
