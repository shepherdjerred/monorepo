/**
 * S3 integration for fetching match data (direct client-side)
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { RawMatchSchema, RawTimelineSchema, type RawMatch, type RawTimeline } from "@shepherdjerred/scout-data";
import { getCachedDataAsync, setCachedData } from "./cache.ts";
import { z } from "zod";
import { eachDayOfInterval, format, startOfDay, endOfDay } from "date-fns";
import { isValidMatchKey } from "./s3-helpers.ts";

/**
 * Fetch all objects from S3 with pagination
 */
async function fetchAllS3Objects(
  client: S3Client,
  bucketName: string,
  prefix: string,
): Promise<{ key: string; lastModified: Date | undefined }[]> {
  type S3Object = {
    Key?: string | undefined;
    LastModified?: Date | undefined;
    ETag?: string | undefined;
    Size?: number | undefined;
    StorageClass?: string | undefined;
  };
  const allContents: S3Object[] = [];
  let nextToken: string | undefined = undefined;
  let iterations = 0;
  const maxIterations = 10; // Max 10k objects (10 * 1000)

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
      ...(nextToken ? { ContinuationToken: nextToken } : {}),
    });

    const response: ListObjectsV2CommandOutput = await client.send(command);

    if (response.Contents) {
      allContents.push(...response.Contents);
    }

    nextToken = response.NextContinuationToken;
    iterations++;
  } while (nextToken && iterations < maxIterations);

  // Validate S3 objects have required Key field using Zod
  const S3ObjectWithKeySchema = z.object({
    Key: z.string(),
    LastModified: z.date().optional(),
  });

  return allContents.flatMap((obj) => {
    const result = S3ObjectWithKeySchema.safeParse(obj);
    if (!result.success) {
      return [];
    }
    const validatedObj = result.data;
    // Filter out keys that don't match the valid match file pattern
    if (!isValidMatchKey(validatedObj.Key)) {
      return [];
    }
    return [
      {
        key: validatedObj.Key,
        lastModified: validatedObj.LastModified,
      },
    ];
  });
}

/**
 * S3 configuration
 */
export type S3Config = {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string; // For Cloudflare R2 or custom S3 endpoints
};

/**
 * Generate date prefixes for S3 listing between start and end dates
 */
function generateDatePrefixes(startDate: Date, endDate: Date): string[] {
  const days = eachDayOfInterval({
    start: startOfDay(startDate),
    end: endOfDay(endDate),
  });

  return days.map((day) => {
    const year = format(day, "yyyy");
    const month = format(day, "MM");
    const dayStr = format(day, "dd");
    return `games/${year}/${month}/${dayStr}/`;
  });
}

/**
 * List matches from S3 for the last 7 days (direct client-side)
 * Results are cached: 10 minutes for today, 24 hours for older days
 */
export async function listMatchesFromS3(config: S3Config): Promise<{ key: string; lastModified: Date | undefined }[]> {
  const allMatches: { key: string; lastModified: Date | undefined }[] = [];

  // Create S3 client
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  // Fetch all 7 days (0 = today, 1 = yesterday, ..., 6 = 6 days ago)
  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysBack);

    const startDate = new Date(targetDate);
    const endDate = new Date(targetDate);

    const prefixes = generateDatePrefixes(startDate, endDate);

    for (const prefix of prefixes) {
      try {
        // Cache key parameters (exclude credentials for security)
        const cacheParams = {
          bucketName: config.bucketName,
          region: config.region,
          endpoint: config.endpoint,
          prefix,
        };

        // Dynamic TTL: 10 minutes for today, 24 hours for older days
        const cacheTTL = daysBack === 0 ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000;

        // Try to get from cache first
        const cached: unknown = await getCachedDataAsync("r2-list", cacheParams);

        let matches: { key: string; lastModified: Date | undefined }[];

        // Validate cached data with Zod
        const CachedMatchListSchema = z.array(
          z.object({
            key: z.string(),
            lastModified: z.string().optional(),
          }),
        );

        const cachedResult = CachedMatchListSchema.safeParse(cached);
        if (cachedResult.success && cachedResult.data.length > 0) {
          // Convert cached string dates back to Date objects
          matches = cachedResult.data.map((obj): { key: string; lastModified: Date | undefined } => {
            const match: { key: string; lastModified: Date | undefined } = {
              key: obj.key,
              lastModified: obj.lastModified ? new Date(obj.lastModified) : undefined,
            };
            return match;
          });
        } else {
          // Fetch directly from S3
          matches = await fetchAllS3Objects(client, config.bucketName, prefix);

          // Cache the result (store dates as ISO strings for serialization)
          const cacheableData = matches.map((m) => {
            if (m.lastModified) {
              return { key: m.key, lastModified: m.lastModified.toISOString() };
            }
            return { key: m.key };
          });
          await setCachedData("r2-list", cacheParams, cacheableData, cacheTTL);
        }

        allMatches.push(...matches);
      } catch (error) {
        console.warn(`Could not list ${prefix}:`, error);
      }
    }
  }

  return allMatches;
}

/**
 * Fetch a match from S3 (direct client-side)
 * Results are cached for 7 days (match data is immutable)
 */
export async function fetchMatchFromS3(config: S3Config, key: string): Promise<RawMatch | null> {
  try {
    // Cache key parameters (exclude credentials for security)
    const cacheParams = {
      bucketName: config.bucketName,
      region: config.region,
      endpoint: config.endpoint,
      key,
    };

    // Try to get from cache first (7 days TTL - match data is immutable)
    const cached: unknown = await getCachedDataAsync("r2-get", cacheParams);

    const cachedResult = RawMatchSchema.safeParse(cached);
    if (cachedResult.success) {
      return cachedResult.data;
    }

    // Cache miss - fetch directly from S3
    console.log(`[S3] Fetching match: ${key}`);

    // Create S3 client
    const client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    // Get object
    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error("Object not found");
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString();
    const rawData: unknown = JSON.parse(bodyString);

    // Validate using proper RawMatch schema
    const rawDataResult = RawMatchSchema.parse(rawData);

    // Cache the result for 7 days (match data is immutable)
    await setCachedData("r2-get", cacheParams, rawDataResult, 7 * 24 * 60 * 60 * 1000);

    return rawDataResult;
  } catch (error) {
    console.error(`Failed to fetch match ${key}:`, error);
    return null;
  }
}

/**
 * Fetch a timeline from S3 (direct client-side)
 * Results are cached for 7 days (timeline data is immutable)
 * @param config - S3 configuration
 * @param matchKey - The S3 key for the match (e.g., games/2024/01/15/NA_123456789/match.json)
 * @returns The timeline data or null if not found
 */
export async function fetchTimelineFromS3(config: S3Config, matchKey: string): Promise<RawTimeline | null> {
  try {
    // Derive timeline key from match key
    // Match key: games/2024/01/15/NA_123456789/match.json
    // Timeline key: games/2024/01/15/NA_123456789/timeline.json
    const timelineKey = matchKey.replace(/\/match\.json$/, "/timeline.json");

    // Cache key parameters (exclude credentials for security)
    const cacheParams = {
      bucketName: config.bucketName,
      region: config.region,
      endpoint: config.endpoint,
      key: timelineKey,
    };

    // Try to get from cache first (7 days TTL - timeline data is immutable)
    const cached: unknown = await getCachedDataAsync("r2-timeline", cacheParams);

    const cachedResult = RawTimelineSchema.safeParse(cached);
    if (cachedResult.success) {
      return cachedResult.data;
    }

    // Cache miss - fetch directly from S3
    console.log(`[S3] Fetching timeline: ${timelineKey}`);

    // Create S3 client
    const client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    // Get object
    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: timelineKey,
    });

    const response = await client.send(command);

    if (!response.Body) {
      console.log(`[S3] Timeline not found: ${timelineKey}`);
      return null;
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString();
    const rawData: unknown = JSON.parse(bodyString);

    // Validate using proper RawTimeline schema
    const rawDataResult = RawTimelineSchema.parse(rawData);

    // Cache the result for 7 days (timeline data is immutable)
    await setCachedData("r2-timeline", cacheParams, rawDataResult, 7 * 24 * 60 * 60 * 1000);

    return rawDataResult;
  } catch (error) {
    console.error(`Failed to fetch timeline for match ${matchKey}:`, error);
    return null;
  }
}
