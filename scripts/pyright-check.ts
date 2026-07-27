import { run } from "./lib/run.ts";

export const PYRIGHT_VERSION = "1.1.411";

export async function checkPythonTypes(): Promise<void> {
  if (!(await Bun.file(".venv/bin/python").exists())) {
    console.log("Creating Python dev venv (.venv) for pyright...");
    await run(["uv", "venv", "--python", "3.12", ".venv"]);
  }
  await run([
    "uv",
    "pip",
    "install",
    "--quiet",
    "-r",
    "scripts/python-dev-requirements.txt",
    "--python",
    ".venv/bin/python",
  ]);
  await run(["uvx", `pyright@${PYRIGHT_VERSION}`]);
}

if (import.meta.main) {
  await checkPythonTypes();
}
