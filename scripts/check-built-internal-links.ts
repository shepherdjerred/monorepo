import path from "node:path";

const siteName = Bun.argv[2];
if (siteName !== "sjer.red" && siteName !== "webring/example") {
  throw new Error(
    `Expected a supported site name, received ${siteName ?? "nothing"}`,
  );
}

const distDirectory = path.join(process.cwd(), "dist");
const htmlFiles = [
  ...new Bun.Glob("**/*.html").scanSync({
    cwd: distDirectory,
    onlyFiles: true,
  }),
].sort();

if (htmlFiles.length === 0) {
  throw new Error(`No built HTML files found in ${distDirectory}`);
}

function outputPaths(target: string): string[] {
  const relativeTarget = decodeURIComponent(target.slice(1));
  const filePath = path.join(distDirectory, relativeTarget);
  if (relativeTarget.endsWith("/")) {
    return [path.join(filePath, "index.html")];
  }
  return [filePath, path.join(filePath, "index.html")];
}

const broken: string[] = [];
let checked = 0;
const attributePattern =
  /(?:href|src)=(['"])(\/[^'"#?\s>]*)(?:[?#][^'"]*)?\1/gu;

function siteOwnedMarkup(html: string): string {
  if (siteName !== "sjer.red") {
    return html;
  }

  // Webring previews are sanitized HTML fetched from other sites. A relative
  // link in that content belongs to the source site, not sjer.red.
  return html.replaceAll(
    /<p\s[^>]*class=(['"])[^'"]*summary[^'"]*\1[^>]*>[\s\S]*?<\/p>(?:\s*<\/p>)?/gu,
    "",
  );
}

for (const htmlFile of htmlFiles) {
  const html = siteOwnedMarkup(
    await Bun.file(path.join(distDirectory, htmlFile)).text(),
  );
  for (const match of html.matchAll(attributePattern)) {
    const target = match[2];
    if (target === undefined || target.startsWith("//")) {
      continue;
    }
    checked += 1;
    const candidateResults = await Promise.all(
      outputPaths(target).map((candidate) => Bun.file(candidate).exists()),
    );
    const exists = candidateResults.some(Boolean);
    if (!exists) {
      broken.push(`${htmlFile} -> ${target}`);
    }
  }
}

if (broken.length > 0) {
  throw new Error(
    `${siteName} has ${String(broken.length)} broken internal link(s):\n${broken.join("\n")}`,
  );
}

console.log(
  `${siteName}: checked ${String(checked)} built internal page and asset links`,
);
