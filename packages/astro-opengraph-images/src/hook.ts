import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { AstroBuildDoneHookInput, IntegrationOptions, Page, RenderFunction } from "./types.js";
import * as fs from "fs/promises";
import type { AstroIntegrationLogger } from "astro";
import { extract, sanitizeHtml } from "./extract.js";
import { getFilePath } from "./util.js";
import { fileURLToPath } from "url";
import * as jsdom from "jsdom";
import path from "path";

export async function buildDoneHook({
  logger,
  pages,
  options,
  dir,
  render,
}: AstroBuildDoneHookInput & {
  options: IntegrationOptions;
  render: RenderFunction;
}) {
  logger.info("Generating Open Graph images");
  const promises = pages.map((page) => handlePage({ page, options, render, dir, logger }));
  await Promise.all(promises);
}

interface HandlePageInput {
  page: Page;
  options: IntegrationOptions;
  render: RenderFunction;
  dir: URL;
  logger: AstroIntegrationLogger;
}

async function handlePage({ page, options, render, dir, logger }: HandlePageInput) {
  // gets the absolute path to the HTML file. E.g. /home/user/project/dist/blog/index.html
  // fileURLToPath() converts the URL to a file path. Without it, the path would start with a leading slash on Windows
  // systems, resulting in an invalid path.
  const htmlFile = getFilePath({ dir: fileURLToPath(dir), page: page.pathname });

  // read the HTML file and parse it with jsdom
  const html = (await fs.readFile(htmlFile)).toString();
  const document = new jsdom.JSDOM(sanitizeHtml(html)).window.document;

  // extract the OpenGraph properties from the HTML file
  const pageDetails = extract(document);

  // render the image using Satori and Resvg
  const reactNode = await render({ ...page, ...pageDetails, dir, document });
  const svg = await satori(reactNode, options);
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
    },
    fitTo: {
      mode: "width",
      value: options.width,
    },
  });

  // save the image as a PNG file. The file name is the same as the HTML file, but with a .png extension.
  const pngFile = htmlFile.replace(/\.html$/, ".png");
  await fs.writeFile(pngFile, resvg.render().asPng());

  // get the relative filesystem path to the PNG file from the output directory. E.g. blog/index.png
  // path.relative() returns the relative path from the first argument to the second argument.
  const relativePngFile = path.relative(fileURLToPath(dir), pngFile).replace(/\\/g, "/");

  // convert the image path to a URL, decode URL-encoded characters, and remove the leading slash
  const imageUrl = decodeURIComponent(new URL(pageDetails.image).pathname.slice(1));

  // check that the og:image property matches the sitePath
  if (imageUrl !== relativePngFile) {
    throw new Error(
      `The og:image property in ${htmlFile} (${imageUrl}) does not match the generated image (${relativePngFile}).`,
    );
  }

  if (options.verbose) {
    logger.info(`Generated ${relativePngFile} for ${htmlFile}.`);
  }
}
