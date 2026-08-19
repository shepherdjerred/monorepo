import configuration from "#src/configuration.ts";

function getOrigin(): string {
  return (configuration.webAppOrigin ?? "https://scout-for-lol.com").replace(
    /\/$/u,
    "",
  );
}

export function getDashboardUrl(): string {
  return `${getOrigin()}/app/`;
}

export function getDocsUrl(): string {
  return `${getOrigin()}/docs/`;
}

export function getExploreConversationUrl(conversationId: string): string {
  return `${getOrigin()}/app/explore/${conversationId}/`;
}
