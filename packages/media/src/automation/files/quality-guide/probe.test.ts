import { expect, test } from "vitest";
import { probeAttributes } from "#automation/files/inspection.ts";
import { inspectMedia, type RunMediaTool } from "#filesystem/media-tools.ts";

const run: RunMediaTool = async () =>
  new TextEncoder().encode(
    JSON.stringify({
      format: { duration: "120.125", size: "1000", format_name: "matroska" },
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "hevc",
          width: 3840,
          height: 2160,
          side_data_list: [
            {
              side_data_type: "DOVI configuration record",
              dv_profile: 8,
              bl_present_flag: 1,
              dv_bl_signal_compatibility_id: 1,
            },
          ],
        },
        ...["eng", "jpn", "zho", "chi", "en-US", "zh-Hant", "und"].map(
          (language, index) => ({
            index: index + 1,
            codec_type: "audio",
            codec_name: "eac3",
            tags: { language },
          }),
        ),
      ],
    }),
  );
test("actual ffprobe parsing preserves Dolby compatibility and normalizes measured track languages", async () => {
  const probe = await inspectMedia("/fixture/movie.mkv", { run });
  expect(probeAttributes(probe, "WEB-1080p")).toEqual({
    quality: "WEB-2160p",
    codec: "HEVC",
    audioLanguages: ["en", "ja", "zh"],
    videoCompatibility: "compatible",
  });
});
