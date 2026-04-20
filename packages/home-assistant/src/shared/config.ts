export type HomeAssistantConfig = {
  baseUrl: string;
  token: string;
};

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}
