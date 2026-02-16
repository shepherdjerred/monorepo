import { z } from "zod";

export type Source = z.infer<typeof SourceSchema>;
/** An RSS source */
const SourceSchema = z.object({
  /** The URL of an RSS feed */
  url: z.string(),
  /** A title to describe the feed */
  title: z.string().describe("A title for the feed"),
  /** Takes a entry preview and returns whether or not it should be displayed */
  filter: z.function().args(z.string()).returns(z.boolean()).optional(),
});

export type CacheConfiguration = z.infer<typeof CacheConfigurationSchema>;
/** Configuration for the cache */
const CacheConfigurationSchema = z.object({
  /** How long to cache a result for */
  cache_duration_minutes: z.number().default(60),
  /** The location of a file to use as a cache */
  cache_file: z.string().default("cache.json"),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;
/** A configuration object with caching possibly configured */
const ConfigurationSchema = z.object({
  /** A list of sources to fetch */
  sources: SourceSchema.array(),
  /** Return the n latest updates from the source list. */
  number: z.number().default(3),
  /** How many words the preview field should be truncated to in characters after HTML has been sanitized and parsed. */
  truncate: z.number().default(300),
  /** Configuration for the cache */
  cache: CacheConfigurationSchema.optional(),
  /** Randomize the output order */
  shuffle: z.boolean().default(false).optional(),
});

export type CachedConfiguration = z.infer<typeof CachedConfigurationSchema>;
/** A configuration object with caching definitely configured */
export const CachedConfigurationSchema = ConfigurationSchema.extend({
  /** Configuration for the cache */
  cache: CacheConfigurationSchema,
});

export type ResultEntry = z.infer<typeof ResultEntrySchema>;
/** A single entry from an RSS feed */
const ResultEntrySchema = z.object({
  /** The title of the entry */
  title: z.string(),
  /** A direct link to the entry */
  url: z.string(),
  /** The date of the entry */
  date: z.coerce.date(),
  /** The source the entry is from */
  source: SourceSchema,
  /** A preview of the entry. This may contain sanitized HTML. */
  preview: z.string().optional(),
});

export type Result = z.infer<typeof ResultSchema>;
/** A list of results */
export const ResultSchema = z.array(ResultEntrySchema);

export type CacheEntry = z.infer<typeof CacheEntrySchema>;
/** A single cache entry */
export const CacheEntrySchema = z.object({
  /** The time a source was last checked */
  timestamp: z.coerce.date(),
  /** The data from the source */
  data: ResultEntrySchema,
});

export type Cache = z.infer<typeof CacheSchema>;
/** A mapping of source URLs to cache entries */
export const CacheSchema = z.record(CacheEntrySchema);

/** The expected format fetched RSS feed entries */
export const FeedEntrySchema = z
  .object({
    title: z.string(),
    link: z.string(),
    isoDate: z.coerce.date().optional(),
    pubDate: z.coerce.date().optional(),
    content: z.string().optional(),
    contentSnippet: z.string().optional(),
    "content:encoded": z.string().optional(),
    description: z.string().optional(),
  })
  .transform((entry) => {
    const date = entry.isoDate ?? entry.pubDate;
    if (!date) {
      throw new Error("no date found in feed entry");
    }
    return {
      title: entry.title,
      link: entry.link,
      date,
      content: entry.content,
      contentSnippet: entry.contentSnippet,
      description: entry.description,
      "content:encoded": entry["content:encoded"],
    };
  });
