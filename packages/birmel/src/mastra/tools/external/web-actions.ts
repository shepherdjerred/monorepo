type WebResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

export async function handleFetchUrl(
  url: string | undefined,
  maxLength: number | undefined,
): Promise<WebResult> {
  if (url == null || url.length === 0) {
    return { success: false, message: "url is required for fetch-url" };
  }
  const response = await fetch(url, {
    headers: { "User-Agent": "Birmel Discord Bot/1.0" },
  });
  if (!response.ok) {
    return {
      success: false,
      message: `Failed to fetch URL: ${String(response.status)}`,
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain")
  ) {
    return { success: false, message: "URL does not return text content" };
  }
  const html = await response.text();
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.trim();
  let content = html
    .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replaceAll(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const max = maxLength ?? 2000;
  if (content.length > max) {
    content = content.slice(0, Math.max(0, max)) + "...";
  }
  return {
    success: true,
    message: "Successfully fetched URL",
    data: {
      ...(title != null && title.length > 0 && { title }),
      content,
      url,
    },
  };
}

export async function handleSearch(
  query: string | undefined,
): Promise<WebResult> {
  if (query == null || query.length === 0) {
    return { success: false, message: "query is required for search" };
  }
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: { "User-Agent": "Birmel Discord Bot/1.0" },
  });
  if (!response.ok) {
    return {
      success: false,
      message: `Search failed: ${String(response.status)}`,
    };
  }
  const html = await response.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const resultRegex =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
    const [, matchUrl, matchTitle, snippetHtml] = match;
    if (
      matchUrl != null &&
      matchUrl.length > 0 &&
      matchTitle != null &&
      matchTitle.length > 0 &&
      snippetHtml != null &&
      snippetHtml.length > 0
    ) {
      results.push({
        title: matchTitle.trim(),
        url: decodeURIComponent(
          matchUrl
            .replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "")
            .split("&")[0] ?? "",
        ),
        snippet: snippetHtml.replaceAll(/<[^>]+>/g, "").trim(),
      });
    }
  }
  return {
    success: true,
    message: `Found ${String(results.length)} results`,
    data: { results },
  };
}

type NewsArticle = {
  title: string;
  description: string | null;
  url: string;
  source: { name: string };
  publishedAt: string;
};

type NewsApiResponse = {
  status: string;
  articles: NewsArticle[];
};

export async function handleNews(
  apiKey: string | undefined,
  query: string | undefined,
  newsCategory: string | undefined,
  newsCount: number | undefined,
): Promise<WebResult> {
  if (apiKey == null || apiKey.length === 0) {
    return { success: false, message: "News API key not configured" };
  }
  const params = new URLSearchParams({
    apiKey,
    pageSize: String(newsCount ?? 5),
    language: "en",
  });
  let endpoint: string;
  if (query != null && query.length > 0) {
    params.set("q", query);
    endpoint = "everything";
  } else {
    params.set("country", "us");
    if (newsCategory != null && newsCategory.length > 0) {
      params.set("category", newsCategory);
    }
    endpoint = "top-headlines";
  }
  const response = await fetch(
    `https://newsapi.org/v2/${endpoint}?${params.toString()}`,
  );
  if (!response.ok) {
    return {
      success: false,
      message: `News API error: ${String(response.status)}`,
    };
  }
  const data = (await response.json()) as NewsApiResponse;
  if (data.status !== "ok") {
    return { success: false, message: "Failed to fetch news" };
  }
  const articles = data.articles.map((a) => ({
    title: a.title,
    description: a.description,
    url: a.url,
    source: a.source.name,
    publishedAt: a.publishedAt,
  }));
  return {
    success: true,
    message: `Found ${String(articles.length)} articles`,
    data: articles,
  };
}

export async function handleLol(
  lolType: "patch" | "status" | "champions" | undefined,
  riotApiKey: string | undefined,
): Promise<WebResult> {
  const type = lolType ?? "patch";
  if (type === "patch" || type === "champions") {
    const response = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
    );
    if (!response.ok) {
      return { success: false, message: "Failed to fetch patch info" };
    }
    const versions = (await response.json()) as string[];
    const latestVersion = versions[0];
    if (type === "patch") {
      return {
        success: true,
        message: `Current LoL patch: ${latestVersion ?? "Unknown"}`,
        data: {
          version: latestVersion,
          info: "https://www.leagueoflegends.com/en-us/news/tags/patch-notes/",
        },
      };
    }
    return {
      success: true,
      message: "Champion data available",
      data: {
        version: latestVersion,
        info: `https://ddragon.leagueoflegends.com/cdn/${latestVersion ?? "latest"}/data/en_US/champion.json`,
      },
    };
  }
  // status
  if (riotApiKey == null || riotApiKey.length === 0) {
    return { success: false, message: "Riot API key not configured" };
  }
  const response = await fetch(
    "https://na1.api.riotgames.com/lol/status/v4/platform-data",
    { headers: { "X-Riot-Token": riotApiKey } },
  );
  if (!response.ok) {
    return {
      success: false,
      message: `Riot API error: ${String(response.status)}`,
    };
  }
  const data = (await response.json()) as {
    incidents: unknown[];
    maintenances: unknown[];
  };
  const incidents = data.incidents.length;
  const maintenances = data.maintenances.length;
  return {
    success: true,
    message: `LoL Status: ${String(incidents)} incidents, ${String(maintenances)} maintenances`,
    data: {
      status:
        incidents === 0 && maintenances === 0
          ? "All systems operational"
          : `${String(incidents)} incidents, ${String(maintenances)} maintenances`,
    },
  };
}
