import path from "node:path";
import {
  fromOpenSubtitles,
  type SubtitleSearch,
} from "#automation/subtitle-sources.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

/** Actual provider adapter and durable download producer; remote responses and bytes are synthetic. */
export async function captionProviderFixture(context: MediaAutomationContext) {
  const credential = await context.db.credential.create({
    data: {
      kind: "provider",
      ciphertext: context.cipher.encrypt(
        JSON.stringify({
          apiKey: "synthetic",
          userAgent: "synthetic",
          username: "synthetic",
          password: "synthetic",
        }),
        "provider:opensubtitles",
      ),
    },
  });
  await context.db.mediaProvider.upsert({
    where: { id: "opensubtitles" },
    create: { id: "opensubtitles", enabled: true, credentialId: credential.id },
    update: { enabled: true, credentialId: credential.id },
  });
  return {
    opensubtitles: async (
      network: MediaAutomationContext,
      query: SubtitleSearch,
    ) => {
      const filename = `${path.basename(query.sourceFilename, path.extname(query.sourceFilename))}.srt`;
      return fromOpenSubtitles(network, query, (url) => {
        if (url.pathname.endsWith("/login"))
          return Promise.resolve(Response.json({ token: "synthetic" }));
        if (url.pathname.endsWith("/subtitles"))
          return Promise.resolve(
            Response.json({
              total_pages: 1,
              data: [
                {
                  id: "1",
                  attributes: {
                    language:
                      query.language === "zh-Hans" ? "zh-cn" : query.language,
                    release: "Synthetic human caption",
                    ai_translated: false,
                    machine_translated: false,
                    foreign_parts_only: false,
                    hearing_impaired: false,
                    files: [{ file_id: 1, file_name: filename }],
                  },
                },
              ],
            }),
          );
        if (url.pathname.endsWith("/download"))
          return Promise.resolve(
            Response.json({
              link: "https://dl.opensubtitles.com/library-notice.srt",
              file_name: filename,
            }),
          );
        if (url.hostname === "dl.opensubtitles.com")
          return Promise.resolve(
            new Response(
              `1\n00:00:00,000 --> 00:00:01,000\n${query.language === "zh-Hans" ? "这是一个简体中文字幕测试，汉语龙马风云国书车头发现。" : "Synthetic human caption"}\n`,
            ),
          );
        throw new Error(
          `Unexpected synthetic caption endpoint: ${url.pathname}`,
        );
      });
    },
  };
}
