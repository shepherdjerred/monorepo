import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserSchema } from "#shared/contract.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { RequestProtection } from "./protection.tsx";

test.each([true, false])(
  "request-list protection-only controls retain own cancellation and effective Keep=%s",
  (effective) => {
    const user = UserSchema.parse({
      id: crypto.randomUUID(),
      plexAccountId: "123",
      displayName: "Member",
      role: "member",
      restricted: false,
      version: 0,
    });
    const request = {
      id: crypto.randomUUID(),
      mediaId: crypto.randomUUID(),
      version: 2,
      active: true,
    };
    const client = new QueryClient();
    client.setQueryData(
      ["target", request.mediaId],
      DefaultTargetViewSchema.parse({
        schemaVersion: 2,
        access: "protection_only",
        scope: { mediaId: request.mediaId, edition: "default" },
        expected: { mediaVersion: 4, targetVersion: 1 },
        ownRequests: [
          { id: request.id, version: 2, active: true, canCancel: true },
        ],
        allowedProtectiveActions: effective
          ? ["keep", "cancel_request"]
          : ["cancel_request"],
      }),
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RequestProtection user={user} request={request} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Cancel request");
    expect(html.includes("Keep for 30 days")).toBe(effective);
    expect(html).toContain("library details unavailable");
    for (const forbidden of [
      "Restore to library",
      "Select release",
      "Retry acquisition",
      "Pin indefinitely",
      "mediaVersion",
      "targetVersion",
      "Other household",
    ])
      expect(html).not.toContain(forbidden);
    client.clear();
  },
);
