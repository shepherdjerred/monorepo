import path from "node:path";
import { access } from "node:fs/promises";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// some files, e.g. index or 404 pages, are served without a folder
// other files, e.g. blog posts, are served from a folder
// I don't fully understand how Astro decides this, so:
export async function getFilePath({
  dir,
  page,
}: {
  dir: string;
  page: string;
}) {
  let target: string = path.join(dir, page, "index.html");

  if (!(await fileExists(target))) {
    target = path.join(dir, page.slice(0, -1) + ".html");
  }

  return target;
}

export function getImagePath({
  url,
  site,
}: {
  url: URL;
  site: URL | undefined;
}): string {
  if (site === undefined) {
    throw new Error(
      "`site` must be set in your Astro configuration: https://docs.astro.build/en/reference/configuration-reference/#site",
    );
  }

  let target = url.pathname;

  // if url ends with a slash, it's a directory
  // add index.png to the end
  target = target.endsWith("/") ? target + "index.png" : target + ".png";

  // Astro creates these as top-level files rather than in a folder
  if (target === "/404/index.png") {
    return site.toString() + "404.png";
  } else if (target === "/500/index.png") {
    return site.toString() + "500.png";
  }

  // remove leading slash
  target = target.slice(1);
  // add site URL
  target = site.toString() + target;

  return target;
}
