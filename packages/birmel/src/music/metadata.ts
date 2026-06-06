export type MusicTrackInfo = {
  title: string;
  duration: string;
  url: string;
  requestedBy?: string;
  source?: string;
  coverUrl?: string;
};

function readProperty(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function readString(value: object, key: string): string | undefined {
  const property = readProperty(value, key);
  if (typeof property === "string" && property.length > 0) {
    return property;
  }
  return undefined;
}

function readNumber(value: object, key: string): number | undefined {
  const property = readProperty(value, key);
  if (typeof property === "number" && Number.isFinite(property)) {
    return property;
  }
  return undefined;
}

function readNestedString(
  value: object,
  parentKey: string,
  childKey: string,
): string | undefined {
  const parent = readProperty(value, parentKey);
  if (typeof parent !== "object" || parent == null) {
    return undefined;
  }
  return readString(parent, childKey);
}

function normalizeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function extractYouTubeVideoId(url: string): string | undefined {
  const parsed = normalizeUrl(url);
  if (parsed == null) {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const isYouTubeHost = host === "youtube.com" || host === "youtu.be";
  if (!isYouTubeHost) {
    return undefined;
  }

  const searchParamId = parsed.searchParams.get("v");
  if (searchParamId != null && searchParamId.length > 0) {
    return searchParamId;
  }

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (host === "youtu.be") {
    return pathParts[0];
  }

  const videoPathPrefixes = new Set(["embed", "shorts", "live"]);
  const [firstPart, secondPart] = pathParts;
  if (
    firstPart != null &&
    secondPart != null &&
    videoPathPrefixes.has(firstPart)
  ) {
    return secondPart;
  }

  return undefined;
}

export function buildYouTubeCoverUrl(url: string): string | undefined {
  const videoId = extractYouTubeVideoId(url);
  if (videoId == null || videoId.length === 0) {
    return undefined;
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function parseDurationToSeconds(duration: string): number | undefined {
  const parts = duration.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  let total = 0;
  for (const part of parts) {
    total = total * 60 + part;
  }
  return total;
}

export function formatDurationFromSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes)}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function sumDurations(tracks: MusicTrackInfo[]): string | undefined {
  let totalSeconds = 0;
  let foundDuration = false;
  for (const track of tracks) {
    const seconds = parseDurationToSeconds(track.duration);
    if (seconds != null) {
      totalSeconds += seconds;
      foundDuration = true;
    }
  }
  if (!foundDuration) {
    return undefined;
  }
  return formatDurationFromSeconds(totalSeconds);
}

export function normalizeTrack(track: object): MusicTrackInfo {
  const title = readString(track, "title") ?? "Unknown track";
  const duration = readString(track, "duration") ?? "unknown";
  const url = readString(track, "url") ?? "";
  const requestedBy =
    readNestedString(track, "requestedBy", "username") ??
    readNestedString(track, "requestedBy", "id");
  const source = readString(track, "source");
  const thumbnail =
    readString(track, "thumbnail") ??
    readString(track, "cover") ??
    readString(track, "artworkUrl") ??
    buildYouTubeCoverUrl(url);

  return {
    title,
    duration,
    url,
    ...(requestedBy != null && { requestedBy }),
    ...(source != null && { source }),
    ...(thumbnail != null && { coverUrl: thumbnail }),
  };
}

export function trackDurationSeconds(track: object): number | undefined {
  const durationMs = readNumber(track, "durationMS");
  if (durationMs != null) {
    return Math.floor(durationMs / 1000);
  }
  const duration = readString(track, "duration");
  if (duration == null) {
    return undefined;
  }
  return parseDurationToSeconds(duration);
}
