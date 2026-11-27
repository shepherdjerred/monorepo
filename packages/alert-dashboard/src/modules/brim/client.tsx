import { GaugeIcon } from "lucide-react";
import { lazy } from "react";

import type { ClientModule } from "#client/platform/module.ts";

const BrimOverviewPage = lazy(async () => {
  const { BrimOverviewPage: page } = await import("./overview.tsx");
  return { default: page };
});
const BrimPrioritiesPage = lazy(async () => {
  const { BrimPrioritiesPage: page } = await import("./priorities.tsx");
  return { default: page };
});
const BrimRequestPage = lazy(async () => {
  const { BrimRequestPage: page } = await import("./request.tsx");
  return { default: page };
});
const BrimSessionsPage = lazy(async () => {
  const { BrimSessionsPage: page } = await import("./sessions.tsx");
  return { default: page };
});
const BrimSessionPage = lazy(async () => {
  const { BrimSessionPage: page } = await import("./sessions.tsx");
  return { default: page };
});
const BrimUsagePage = lazy(async () => {
  const { BrimUsagePage: page } = await import("./usage.tsx");
  return { default: page };
});

export const brimClientModule: ClientModule = {
  id: "brim",
  title: "Brim",
  icon: GaugeIcon,
  basePath: "/brim",
  routes: [
    { path: "", page: BrimOverviewPage },
    { path: "usage", page: BrimUsagePage },
    { path: "sessions", page: BrimSessionsPage },
    { path: "sessions/:sessionId", page: BrimSessionPage },
    { path: "sessions/:sessionId/requests/:captureId", page: BrimRequestPage },
    { path: "priorities", page: BrimPrioritiesPage },
  ],
  nav: [
    {
      group: "Ops",
      label: "Brim",
      title: "Brim",
      path: "",
      icon: GaugeIcon,
      keywords: ["quotas", "sessions", "usage", "requests", "Herdr", "billing"],
    },
  ],
};
