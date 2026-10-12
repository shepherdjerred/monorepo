import { z } from "zod";
export const HistoryProviderSchema = z.enum([
  "local",
  "youtube",
  "url",
  "streameast",
  "tvsportslive",
]);
