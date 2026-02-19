/**
 * Audio Player
 *
 * Handles audio streaming from various sources (files, URLs, S3, YouTube).
 */

import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "@scout-for-lol/backend/storage/s3-client.ts";
import type { SoundSource } from "@scout-for-lol/data";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("audio-player");

// In-memory tracking of URLs being downloaded
const downloadingUrls = new Set<string>();

/**
 * Convert a web ReadableStream to a Node.js Readable stream.
 * This bridges the type gap between Bun/web ReadableStream<Uint8Array> and
 * Node.js Readable.fromWeb which expects a web-spec ReadableStream.
 */
function webStreamToReadable(stream: ReadableStream<Uint8Array>): Readable {
  const reader = stream.getReader();
  const readable = new Readable({
    // Node requires a read implementation but we push data from the web stream reader
    read() {
      // no-op: data is pushed asynchronously via pump()
    },
  });

  async function pump(): Promise<void> {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          readable.push(null);
          return;
        }
        readable.push(value);
      }
    } catch (error) {
      readable.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  void pump();
  return readable;
}

/**
 * Get an audio stream from a sound source
 */
export async function getAudioStream(source: SoundSource): Promise<Readable> {
  switch (source.type) {
    case "file": {
      // For S3 URLs stored as "file" type with s3:// prefix
      if (source.path.startsWith("s3://")) {
        return getS3AudioStream(source.path);
      }
      // Local file (shouldn't happen in production backend)
      const file = Bun.file(source.path);
      if (await file.exists()) {
        return webStreamToReadable(file.stream());
      }
      throw new Error(`File not found: ${source.path}`);
    }
    case "url": {
      // Check if it's a YouTube URL
      if (isYouTubeUrl(source.url)) {
        return getCachedYouTubeAudio(source.url);
      }
      // Direct URL - fetch and stream
      const response = await fetch(source.url);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch audio from ${source.url}`);
      }

      return webStreamToReadable(response.body);
    }
  }
}

/**
 * Check if a URL is a YouTube URL
 */
function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/**
 * Get audio stream from S3
 */
async function getS3AudioStream(s3Url: string): Promise<Readable> {
  // Parse s3://bucket/key format
  const s3UrlPattern = /^s3:\/\/([^/]+)\/(.+)$/;
  const match = s3UrlPattern.exec(s3Url);
  if (!match) {
    throw new Error(`Invalid S3 URL: ${s3Url}`);
  }
  const [, bucket, key] = match;

  const s3Client = createS3Client();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`No body in S3 response for ${s3Url}`);
  }

  return Readable.from(await response.Body.transformToByteArray());
}

/**
 * Generate S3 key from YouTube URL
 */
function urlToS3Key(url: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(url);
  const hash = hasher.digest("hex");
  return `youtube-cache/${hash.slice(0, 8)}/${hash}.mp3`;
}

/**
 * Check if a YouTube URL is cached in S3
 */
async function isInS3Cache(key: string): Promise<boolean> {
  if (configuration.s3BucketName === undefined) {
    return false;
  }

  const s3Client = createS3Client();
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: configuration.s3BucketName,
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get audio stream from S3 cache
 */
async function getFromS3Cache(key: string): Promise<Readable> {
  if (configuration.s3BucketName === undefined) {
    throw new Error("S3 bucket not configured");
  }

  const s3Client = createS3Client();
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: configuration.s3BucketName,
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error("No body in S3 response");
  }
  return Readable.from(await response.Body.transformToByteArray());
}

/**
 * Get cached YouTube audio, downloading if needed
 */
async function getCachedYouTubeAudio(url: string): Promise<Readable> {
  const s3Key = urlToS3Key(url);

  // Check if already cached in S3
  if (await isInS3Cache(s3Key)) {
    logger.debug(`YouTube audio cache hit: ${url}`);
    return getFromS3Cache(s3Key);
  }

  // Download and cache
  logger.info(`YouTube audio cache miss, downloading: ${url}`);
  await downloadYouTubeAudio(url, s3Key);
  return getFromS3Cache(s3Key);
}

/**
 * Download YouTube audio and cache to S3
 */
async function downloadYouTubeAudio(url: string, s3Key: string): Promise<void> {
  // Prevent duplicate downloads
  if (downloadingUrls.has(url)) {
    // Wait for existing download
    while (downloadingUrls.has(url)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }

  downloadingUrls.add(url);

  try {
    // Use yt-dlp to download audio
    const tempDir = "/tmp/yt-cache";
    const tempDirFile = Bun.file(tempDir);
    if (!(await tempDirFile.exists())) {
      await Bun.write(`${tempDir}/.keep`, "");
    }

    const tempFile = `${tempDir}/${globalThis.crypto.randomUUID()}.mp3`;

    const proc = Bun.spawn([
      "yt-dlp",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "-o",
      tempFile.replace(".mp3", ".%(ext)s"),
      "--no-playlist",
      "--max-filesize",
      "10M",
      url,
    ]);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`yt-dlp exited with code ${String(exitCode)}: ${stderr}`);
    }

    // Upload to S3
    if (configuration.s3BucketName !== undefined && configuration.s3BucketName.length > 0) {
      const file = Bun.file(tempFile);
      const fileBuffer = await file.arrayBuffer();
      const s3Client = createS3Client();
      await s3Client.send(
        new PutObjectCommand({
          Bucket: configuration.s3BucketName,
          Key: s3Key,
          Body: Buffer.from(fileBuffer),
          ContentType: "audio/mpeg",
        }),
      );

      logger.info(`Cached YouTube audio to S3: ${s3Key}`);
    }
  } finally {
    downloadingUrls.delete(url);
  }
}

/**
 * Pre-cache a YouTube URL (async, doesn't block)
 */
export async function cacheYouTubeUrl(
  url: string,
): Promise<{ cached: boolean; key?: string }> {
  if (!isYouTubeUrl(url)) {
    return { cached: false };
  }

  const s3Key = urlToS3Key(url);

  if (await isInS3Cache(s3Key)) {
    return { cached: true, key: s3Key };
  }

  // Start download in background
  void (async () => {
    try {
      await downloadYouTubeAudio(url, s3Key);
    } catch (error) {
      logger.error(`Failed to cache YouTube URL: ${url}`, error);
    }
  })();

  return { cached: false, key: s3Key };
}

/**
 * Check if a URL is cached
 */
export async function getCacheStatus(
  url: string,
): Promise<"cached" | "downloading" | "not-cached"> {
  if (downloadingUrls.has(url)) {
    return "downloading";
  }

  const s3Key = urlToS3Key(url);
  if (await isInS3Cache(s3Key)) {
    return "cached";
  }

  return "not-cached";
}
