type SnapshotNode = {
  readonly ref: string;
  readonly tag?: string | undefined;
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly frameUrl?: string | undefined;
  readonly childFrameUrl?: string | undefined;
};

type NetworkEntry = {
  readonly requestHeaders?: Readonly<Record<string, string>> | undefined;
};

export function approvedPlayerFrameUrl(value: string): boolean {
  try {
    const frame = new URL(value);
    return (
      frame.protocol === "https:" &&
      frame.hostname === "streame.center" &&
      frame.pathname === "/stream-east/hls.php" &&
      frame.username.length === 0 &&
      frame.password.length === 0 &&
      frame.port.length === 0
    );
  } catch {
    return false;
  }
}

export function approvedTvSportsPlayerUrl(value: string): boolean {
  try {
    const page = new URL(value);
    return (
      page.protocol === "https:" &&
      page.hostname === "embed.st" &&
      /^\/embed\/admin\/[a-z0-9-]+\/\d+$/.test(page.pathname) &&
      page.username.length === 0 &&
      page.password.length === 0 &&
      page.port.length === 0
    );
  } catch {
    return false;
  }
}

export function approvedRuntimePlayerUrl(page: URL): boolean {
  return (
    page.protocol === "https:" &&
    page.username.length === 0 &&
    page.password.length === 0 &&
    page.port.length === 0 &&
    (page.hostname === "streame.center" ||
      approvedTvSportsPlayerUrl(page.toString()))
  );
}

export function approvedCapturedHlsUrl(value: string, player: URL): boolean {
  try {
    const stream = new URL(value);
    if (
      stream.protocol !== "https:" ||
      stream.username.length > 0 ||
      stream.password.length > 0 ||
      stream.port.length > 0 ||
      !/\.m3u8$/i.test(stream.pathname)
    ) {
      return false;
    }
    return player.hostname === "embed.st"
      ? /^lb\d+\.strmd\.st$/.test(stream.hostname)
      : stream.hostname === "streame.center" ||
          /^edgestream\d+\.pro$/.test(stream.hostname);
  } catch {
    return false;
  }
}

export function playerControlRef(
  nodes: readonly SnapshotNode[],
  page: URL,
): string | undefined {
  return nodes.find((node) =>
    page.hostname === "embed.st"
      ? node.role === "button" &&
        node.name === "Play" &&
        node.frameUrl === page.toString()
      : node.tag === "svg" &&
        node.frameUrl !== undefined &&
        approvedPlayerFrameUrl(node.frameUrl),
  )?.ref;
}

export function playerFrameRef(
  nodes: readonly SnapshotNode[],
): string | undefined {
  return nodes.find(
    (node) =>
      node.tag === "iframe" &&
      node.childFrameUrl !== undefined &&
      approvedPlayerFrameUrl(node.childFrameUrl),
  )?.ref;
}

export function capturedHeaders(
  entry: NetworkEntry,
  fallbackReferer: string,
): Readonly<Record<string, string>> {
  const requestHeaders = entry.requestHeaders ?? {};
  const header = (name: string): string | undefined =>
    Object.entries(requestHeaders).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
  const headers: Record<string, string> = {};
  const userAgent = header("user-agent");
  const origin = header("origin");
  if (userAgent !== undefined) headers["User-Agent"] = userAgent;
  if (origin !== undefined) headers["Origin"] = origin;
  headers["Referer"] = header("referer") ?? fallbackReferer;
  return headers;
}

export function playerHlsUrl(html: string): string | null {
  const raw =
    /\b(?:var|let|const)\s+streamUrl\s*=\s*["']([^"']+\.m3u8(?:\?[^"']*)?)["']/.exec(
      html,
    )?.[1];
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      /^edgestream\d+\.pro$/.test(url.hostname) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.port.length === 0
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
