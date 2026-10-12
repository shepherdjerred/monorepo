import type { parseDocument } from "htmlparser2";
import { DomUtils, ElementType } from "htmlparser2";

type Node = ReturnType<typeof parseDocument>["children"][number];
export type ArchiveElement = Parameters<
  Parameters<typeof DomUtils.findAll>[0]
>[0];
export const hasClass = (node: ArchiveElement, name: string): boolean =>
  (node.attribs["class"] ?? "").split(/\s+/).includes(name);
export const findAll = DomUtils.findAll;
export const textContent = DomUtils.textContent;

export function originalUrl(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const raw = value.replace(
    /^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//,
    "",
  );
  try {
    const url = new URL(raw, "https://ts-mc.net/");
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username !== "" || url.password !== "") return undefined;
    url.protocol = "https:";
    if (url.port === "80") url.port = "";
    return url.href.replaceAll("[", "%5B").replaceAll("]", "%5D");
  } catch {
    return undefined;
  }
}

function imageCode(
  node: ArchiveElement,
  images: Map<string, string>,
  attachments: Set<number>,
): string {
  if (hasClass(node, "mceSmilie")) return node.attribs["alt"] ?? "";
  const url = originalUrl(
    node.attribs["data-url"] ?? node.attribs["src"] ?? "",
  );
  if (url === undefined) return "";
  const id = /\/attachments\/[^/]*\.(\d+)(?:\/|$)/.exec(url)?.[1];
  if (id !== undefined && attachments.has(Number(id)))
    return `[ATTACH]${id}[/ATTACH]`;
  const file = images.get(url);
  if (file !== undefined) return `[IMG]/data/storm-history/${file}[/IMG]`;
  const alt = node.attribs["alt"]?.replaceAll(/[[\]]/g, "") ?? "Image";
  return `[URL=${url}]${alt === "" ? "Image" : alt}[/URL]`;
}

function embedCode(node: ArchiveElement): string {
  const url = originalUrl(node.attribs["src"] ?? "");
  if (url === undefined) return "";
  const video =
    /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]+)/.exec(
      url,
    )?.[1];
  return video === undefined
    ? `[URL=${url}]View embedded content[/URL]`
    : `[MEDIA=youtube]${video}[/MEDIA]`;
}

export function archiveBBCode(
  body: ArchiveElement,
  images: Map<string, string>,
  attachments: Set<number>,
): string {
  const content = (nodes: Node[]): string =>
    nodes.map((node) => render(node)).join("");
  function quoteCode(node: ArchiveElement): string {
    const attribution = findAll(
      (n) => hasClass(n, "attribution"),
      node.children,
    )[0];
    const author =
      attribution === undefined
        ? ""
        : textContent(attribution)
            .replace(/\s+said:.*$/s, "")
            .trim()
            .replaceAll(/["\r\n]/g, "");
    const quote = findAll(
      (n) => hasClass(n, "quoteContainer") || hasClass(n, "quote"),
      node.children,
    )[0];
    const children =
      quote?.children ??
      node.children.filter(
        (n) => !("attribs" in n && hasClass(n, "attribution")),
      );
    return `\n[QUOTE${author === "" ? "" : `="${author}"`}]${content(children).trim()}[/QUOTE]\n`;
  }
  function linkCode(node: ArchiveElement): string {
    const url = originalUrl(node.attribs["href"] ?? ""),
      value = content(node.children);
    return url !== undefined && value.trim() !== ""
      ? `[URL=${url}]${value}[/URL]`
      : value;
  }
  function spoilerCode(node: ArchiveElement): string {
    const spoiler = findAll(
      (n) => hasClass(n, "bbCodeSpoilerContainer"),
      node.children,
    )[0];
    return `[SPOILER]${content(spoiler?.children ?? node.children)}[/SPOILER]`;
  }
  function blockCode(node: ArchiveElement): string {
    const value = content(node.children);
    const tags: Record<string, string> = {
      b: "B",
      strong: "B",
      i: "I",
      em: "I",
      u: "U",
      s: "S",
      strike: "S",
      del: "S",
      pre: "CODE",
      code: "ICODE",
    };
    const tag = tags[node.name];
    if (tag !== undefined)
      return `[${tag}]${node.name === "pre" ? textContent(node) : value}[/${tag}]`;
    if (/^h[1-6]$/.test(node.name))
      return `\n[HEADING=${String(Math.min(Number(node.name.slice(1)), 3))}]${value.trim()}[/HEADING]\n`;
    if (node.name === "ul" || node.name === "ol")
      return `\n[LIST${node.name === "ol" ? "=1" : ""}]${value}[/LIST]\n`;
    if (node.name === "li") return `[*]${value.trim()}\n`;
    return ["p", "div", "blockquote"].includes(node.name)
      ? `\n${value}\n`
      : value;
  }
  function render(node: Node): string {
    if (node.type === ElementType.Text)
      return node.data.replaceAll(/[\r\n\t]+/g, " ").replaceAll(/ {2,}/g, " ");
    if (!("attribs" in node)) return "";
    if (
      ["script", "style", "button", "input"].includes(node.name) ||
      hasClass(node, "messageTextEndMarker") ||
      hasClass(node, "quoteExpand")
    )
      return "";
    if (hasClass(node, "bbCodeQuote")) return quoteCode(node);
    if (hasClass(node, "bbCodeSpoiler")) return spoilerCode(node);
    const special: Record<string, () => string> = {
      br: () => "\n",
      hr: () => "\n[HR][/HR]\n",
      img: () => imageCode(node, images, attachments),
      iframe: () => embedCode(node),
      a: () => linkCode(node),
    };
    return special[node.name]?.() ?? blockCode(node);
  }
  return content(body.children)
    .replaceAll(/ *\n */g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
