export type BugsinkClientResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

function getBaseUrl(): string {
  const baseUrl = Bun.env["BUGSINK_URL"];
  if (!baseUrl) {
    throw new Error("BUGSINK_URL environment variable is not set");
  }
  return baseUrl.replace(/\/$/, "");
}

function getAuthToken(): string {
  const authToken = Bun.env["BUGSINK_TOKEN"];
  if (!authToken) {
    throw new Error("BUGSINK_TOKEN environment variable is not set");
  }
  return authToken;
}

export async function bugsinkRequest<T>(
  endpoint: string,
  params?: Record<string, string>,
): Promise<BugsinkClientResult<T>> {
  try {
    const baseUrl = getBaseUrl();
    const authToken = getAuthToken();
    const url = new URL(`${baseUrl}/api/canonical/0${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Token ${authToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Bugsink API error (${String(response.status)}): ${errorText}`,
      };
    }

    const data = (await response.json()) as T;
    return { success: true, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: message };
  }
}
