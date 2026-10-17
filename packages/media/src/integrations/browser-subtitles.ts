import { load } from "cheerio";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { boundedBytes, sameOriginUrl } from "./providers.ts";
import { isMachineLabelled } from "./subtitle-validation.ts";
import { allowedSubtitleUrl } from "./subtitle-providers.ts";

export type SubtitlePageCandidate = {
  id: string;
  release: string;
  pageUrl: string;
  provenance: "official" | "original" | "other" | "unknown";
  simplifiedLabel: boolean;
};

export class SubhdProvider {
  constructor(private readonly transport: FetchTransport = fetch) {}

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<SubtitlePageCandidate[]> {
    z.string().trim().min(1).max(200).parse(query);
    const url = endpoint(
      "https://subhd.tv",
      `search/${encodeURIComponent(query)}`,
    );
    const response = await request(this.transport, "subhd", url, {
      ...(signal === undefined ? {} : { signal }),
    });
    return parseSubhdSearch(
      new TextDecoder().decode(
        await boundedBytes(response, 2 * 1024 * 1024, "subhd"),
      ),
    );
  }

  async downloadAuthorized(
    url: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const approved = allowedSubtitleUrl(url, ["dl.subhd.me"]);
    return await boundedBytes(
      await request(this.transport, "subhd", approved, {
        ...(signal === undefined ? {} : { signal }),
      }),
      32 * 1024 * 1024,
      "subhd",
    );
  }
}

export function parseSubhdSearch(html: string): SubtitlePageCandidate[] {
  const $ = load(html);
  if (
    $("#challenge-running,iframe[src*='challenges']").length > 0 ||
    /Just a moment/iu.test($("title").text())
  )
    throw new IntegrationError("subhd", "interaction-required");
  const results: SubtitlePageCandidate[] = [];
  for (const block of $("div.bg-white")) {
    const card = $(block);
    const href = card.find("a[href^='/a/']").first().attr("href");
    const id = href?.match(/^\/a\/([a-z\d]+)$/iu)?.[1];
    const release = card.find("div.view-text").text().trim();
    if (id === undefined || release === "") continue;
    const text = card.text();
    const labels = new Set(
      card
        .find("div.text-truncate span")
        .toArray()
        .map((span) => $(span).text().trim()),
    );
    if (
      isMachineLabelled(text) ||
      !["简体", "簡體"].some((label) => labels.has(label)) ||
      !["SRT", "ASS", "SSA"].some((label) => labels.has(label))
    )
      continue;
    const provenance = subhdProvenance(text);
    if (provenance === "unknown") continue;
    results.push({
      id,
      release,
      pageUrl: `https://subhd.tv/a/${id}`,
      provenance,
      simplifiedLabel: true,
    });
  }
  if (
    results.length === 0 &&
    $("div.bg-white").length === 0 &&
    !/没有|暂无|未找到/u.test($("body").text())
  )
    throw new IntegrationError("subhd", "invalid-response");
  return results;
}

function subhdProvenance(text: string): SubtitlePageCandidate["provenance"] {
  if (text.includes("官方字幕")) return "official";
  if (text.includes("原创翻译")) return "original";
  return text.includes("其他来源") ? "other" : "unknown";
}

/** Persistent-profile instance is provisioned separately. Browser cookies/tickets never leave it. */
export class PinchTabSubtitleBrowser {
  constructor(
    private readonly config: {
      baseUrl: string;
      token: string;
      instanceId: string;
    },
    private readonly transport: FetchTransport = fetch,
  ) {}

  async openSubhd(subtitleId: string, signal?: AbortSignal): Promise<string> {
    z.string()
      .regex(/^[a-z\d]+$/iu)
      .parse(subtitleId);
    const result = await this.post(
      `instances/${encodeURIComponent(this.config.instanceId)}/tabs/open`,
      { url: `https://subhd.tv/a/${subtitleId}` },
      signal,
    );
    return z.object({ tabId: z.string().min(1) }).parse(result).tabId;
  }

  /** Call again after a durable wait if the page is still loading. Challenges require human interaction. */
  async prepareSubhd(
    tabId: string,
    subtitleId: string,
    signal?: AbortSignal,
  ): Promise<"loading" | "prepared"> {
    z.string()
      .regex(/^[a-z\d]+$/iu)
      .parse(subtitleId);
    const path = `/a/${subtitleId}`;
    const state = await this.pageState(tabId, path, signal);
    if (state === "loading") return state;
    const expression = `(async()=>{const response=await fetch('/api/sub/prepare-download',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({sid:${JSON.stringify(subtitleId)}})});if(!response.ok)return {prepared:false};const result=await response.json();if(result.success!==true||typeof result.url!=='string')return {prepared:false};const target=new URL(result.url,location.origin);if(target.origin!==location.origin||target.pathname!==${JSON.stringify(`/down/${subtitleId}`)})return {prepared:false};setTimeout(()=>location.assign(target.href),100);return {prepared:true};})()`;
    const result = z
      .object({ prepared: z.boolean() })
      .parse(await this.evaluate(tabId, expression, signal));
    if (!result.prepared)
      throw new IntegrationError("subhd", "interaction-required");
    return "prepared";
  }

  /** The returned short-lived CDN URL stays Activity-local and must not enter workflow history. */
  async resolveSubhd(
    tabId: string,
    subtitleId: string,
    signal?: AbortSignal,
    beforeDownload?: () => Promise<void>,
  ): Promise<{ status: "loading" } | { status: "ready"; url: string }> {
    z.string()
      .regex(/^[a-z\d]+$/iu)
      .parse(subtitleId);
    if (
      (await this.pageState(tabId, `/down/${subtitleId}`, signal)) === "loading"
    )
      return { status: "loading" };
    await beforeDownload?.();
    const expression = `(async()=>{const response=await fetch('/api/sub/down',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:${JSON.stringify(subtitleId)}})});if(!response.ok)return {success:false};const result=await response.json();if(result.success!==true||typeof result.url!=='string')return {success:false};return {success:true,url:result.url};})()`;
    const result = z
      .object({ success: z.boolean(), url: z.string().optional() })
      .parse(await this.evaluate(tabId, expression, signal));
    if (!result.success || result.url === undefined)
      throw new IntegrationError("subhd", "interaction-required");
    return {
      status: "ready",
      url: allowedSubtitleUrl(result.url, ["dl.subhd.me"]).href,
    };
  }

  async close(tabId: string, signal?: AbortSignal): Promise<void> {
    await this.post(`tabs/${encodeURIComponent(tabId)}/close`, {}, signal);
  }

  private async pageState(
    tabId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<"loading" | "ready"> {
    const expression =
      "({origin:location.origin,path:location.pathname,ready:document.readyState,challenge:!!document.querySelector('#challenge-running,iframe[src*=challenges]')||/Just a moment|下载页面已失效/.test(document.title)})";
    const state = z
      .object({
        origin: z.string(),
        path: z.string(),
        ready: z.string(),
        challenge: z.boolean(),
      })
      .parse(await this.evaluate(tabId, expression, signal));
    if (state.challenge)
      throw new IntegrationError("subhd", "interaction-required");
    if (state.origin !== "https://subhd.tv")
      throw new IntegrationError("subhd", "invalid-response");
    return state.path === path && state.ready === "complete"
      ? "ready"
      : "loading";
  }

  private async evaluate(
    tabId: string,
    expression: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const data = await this.post(
      `tabs/${encodeURIComponent(tabId)}/evaluate`,
      { expression, awaitPromise: true },
      signal,
    );
    return z.object({ result: z.unknown() }).parse(data).result;
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await request(
      this.transport,
      "subtitle-browser",
      endpoint(this.config.baseUrl, path),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return await json(response, "subtitle-browser");
  }
}

export class ZimukuProvider {
  private readonly baseUrl = "https://srtku.com";
  constructor(private readonly transport: FetchTransport = fetch) {}

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; pageUrl: string }[]> {
    z.string().trim().min(1).max(200).parse(query);
    const url = endpoint(this.baseUrl, "search");
    url.search = new URLSearchParams({ q: query }).toString();
    const $ = load(await this.html(url, signal));
    const results = $("div.item p.tt.clearfix a")
      .toArray()
      .map((anchor) => {
        const href = $(anchor).attr("href");
        if (href === undefined)
          throw new IntegrationError("zimuku", "invalid-response");
        return {
          title: $(anchor).text().trim(),
          pageUrl: sameOriginUrl(href, this.baseUrl).href,
        };
      });
    if (results.length === 0 && !/没有|暂无|未找到/u.test($("body").text()))
      throw new IntegrationError("zimuku", "invalid-response");
    return results;
  }

  async candidates(
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<SubtitlePageCandidate[]> {
    const $ = load(
      await this.html(sameOriginUrl(pageUrl, this.baseUrl), signal),
    );
    if ($("tbody").length === 0)
      throw new IntegrationError("zimuku", "invalid-response");
    return $("tbody tr")
      .toArray()
      .flatMap((row): SubtitlePageCandidate[] => {
        const element = $(row);
        if (isMachineLabelled(element.text())) return [];
        const link = element.find("a").first();
        const href = link.attr("href");
        if (href === undefined)
          throw new IntegrationError("zimuku", "invalid-response");
        const url = sameOriginUrl(href, this.baseUrl);
        const simplifiedLabel =
          element.find("td.tac.lang img").filter((_index, image) => {
            const src = $(image).attr("src") ?? "";
            return src.includes("china") && !src.includes("hongkong");
          }).length > 0;
        return [
          {
            id: url.pathname,
            release: link.text().trim(),
            pageUrl: url.href,
            provenance: "unknown",
            simplifiedLabel,
          },
        ];
      });
  }

  async download(
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const first = load(
      await this.html(sameOriginUrl(pageUrl, this.baseUrl), signal),
    );
    const next = first("a#down1").attr("href");
    if (next === undefined)
      throw new IntegrationError("zimuku", "invalid-response");
    const second = load(
      await this.html(sameOriginUrl(next, this.baseUrl), signal),
    );
    const final = second("a[rel='nofollow']").attr("href");
    if (final === undefined)
      throw new IntegrationError("zimuku", "invalid-response");
    const approved = allowedSubtitleUrl(new URL(final, this.baseUrl).href, [
      "srtku.com",
      "www.srtku.com",
      "dl.srtku.com",
      "zimuku.org",
      "dl.zimuku.org",
    ]);
    const response = await request(this.transport, "zimuku", approved, {
      headers: { Referer: sameOriginUrl(pageUrl, this.baseUrl).href },
      ...(signal === undefined ? {} : { signal }),
    });
    return await boundedBytes(response, 32 * 1024 * 1024, "zimuku");
  }

  private async html(url: URL, signal?: AbortSignal): Promise<string> {
    const response = await request(this.transport, "zimuku", url, {
      ...(signal === undefined ? {} : { signal }),
    });
    const text = new TextDecoder().decode(
      await boundedBytes(response, 2 * 1024 * 1024, "zimuku"),
    );
    if (/yunsuo|Just a moment|challenge-running|验证码/u.test(text))
      throw new IntegrationError("zimuku", "interaction-required");
    return text;
  }
}
