export type HttpUrlCheckFn = (
  url: string,
  signal?: AbortSignal,
) => Promise<boolean>;

const URL_START_PATTERN = /https?:\/\//giu;
const URL_STOP_CHARS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "<",
  ">",
  '"',
  "'",
  "`",
  "[",
  "]",
]);
const TRAILING_PROSE_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);

export async function verifyUrlHttp200(
  url: string,
  signal?: AbortSignal,
  options?: { httpsOnly?: boolean },
): Promise<boolean> {
  signal?.throwIfAborted();
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  const allowedProtocol =
    options?.httpsOnly === true
      ? parsed.protocol === "https:"
      : parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!allowedProtocol) {
    return false;
  }
  const timeoutSignal = AbortSignal.timeout(10_000);
  const fetchSignal =
    signal === undefined
      ? timeoutSignal
      : AbortSignal.any([signal, timeoutSignal]);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: fetchSignal,
    });
    signal?.throwIfAborted();
    return response.status === 200;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

function scanRawUrlEnd(markdown: string, start: number): number {
  let end = start;
  let openParens = 0;
  while (end < markdown.length) {
    const char = markdown[end];
    if (char === undefined || URL_STOP_CHARS.has(char)) {
      break;
    }
    if (char === "(") {
      openParens += 1;
    } else if (char === ")") {
      if (openParens === 0) {
        break;
      }
      openParens -= 1;
    }
    end += 1;
  }
  return trimTrailingProsePunctuation(markdown, start, end);
}

function trimTrailingProsePunctuation(
  markdown: string,
  start: number,
  initialEnd: number,
): number {
  let end = initialEnd;
  while (
    end > start &&
    TRAILING_PROSE_PUNCTUATION.has(markdown[end - 1] ?? "")
  ) {
    end -= 1;
  }
  return end;
}

export function extractMarkdownHttpUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(URL_START_PATTERN)) {
    const start = match.index;
    const end = scanRawUrlEnd(markdown, start);
    const candidate = markdown.slice(start, end);
    if (URL.canParse(candidate)) {
      urls.add(candidate);
    }
  }
  return [...urls];
}

export function newlyIntroducedMarkdownHttpUrls(
  beforeMarkdown: string,
  afterMarkdown: string,
): string[] {
  const beforeUrls = new Set(extractMarkdownHttpUrls(beforeMarkdown));
  return extractMarkdownHttpUrls(afterMarkdown).filter(
    (url) => !beforeUrls.has(url),
  );
}
