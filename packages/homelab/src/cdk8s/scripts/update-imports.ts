#!/usr/bin/env bun

// delete the imports directory, allow failure
try {
  await Bun.$`rm -rf imports`.quiet();
} catch (error) {
  console.error("Failed to delete imports directory:", error);
}

// run "cdk8s import k8s --language=typescript"
const runCommand = async (command: string, args: string[]) => {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    return output;
  }
  throw new Error(`Command failed with code ${String(exitCode)}`);
};

console.log(await runCommand("cdk8s", ["import", "k8s", "--language=typescript", "--output=generated/imports"]));

// run "kubectl get crds -o json | cdk8s import /dev/stdin --language=typescript"
console.log(
  await runCommand("bash", [
    "-c",
    "kubectl get crds -o json | cdk8s import /dev/stdin --language=typescript --output=generated/imports",
  ]),
);

const files: string[] = [];
// List files in directory using Bun glob
try {
  const importGlob = new Bun.Glob("*.ts");
  for await (const file of importGlob.scan({ cwd: "generated/imports" })) {
    files.push(file);
  }
} catch {
  // Directory may not exist yet
}

// add "// @ts-nocheck" to the top of each file in the imports directory
for (const file of files) {
  const filePath = `generated/imports/${file}`;
  const content = await Bun.file(filePath).text();
  await Bun.write(filePath, `// @ts-nocheck\n${content}`);
}

// look for "public toJson(): any {", change this to "public override toJson(): any {"
// fixes This member must have an 'override' modifier because it overrides a member in the base class 'ApiObject'.
for (const file of files) {
  const filePath = `generated/imports/${file}`;
  let content = await Bun.file(filePath).text();
  content = content.replaceAll("public toJson(): any {", "public override toJson(): any {");
  await Bun.write(filePath, content);
}

// run prettier
console.log(await runCommand("bunx", ["prettier", "--write", "generated/imports"]));
