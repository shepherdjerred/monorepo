import { HeaderBar, type ThemeStore } from "@shepherdjerred/console-ui";
import { Link, Route, Routes } from "react-router";

import { MessageDetailPage } from "./message-detail-page.tsx";
import { OutboxPage } from "./outbox-page.tsx";
import { MailShell } from "./shell.tsx";
import { themeStore } from "./theme.ts";

function NotFoundPage(): React.JSX.Element {
  return (
    <main className="mail-page">
      <title>Not Found | Mail</title>
      <div className="mail-back-bar">
        <Link className="mail-back-link" to="/">
          ← Outbox
        </Link>
      </div>
      <HeaderBar title="Page not found" />
      <p className="mail-state ui-muted">
        The requested Mail console route does not exist.
      </p>
    </main>
  );
}

export function App({
  theme = themeStore,
}: {
  readonly theme?: ThemeStore;
}): React.JSX.Element {
  return (
    <Routes>
      <Route element={<MailShell theme={theme} />}>
        <Route index element={<OutboxPage />} />
        <Route path="messages/:id" element={<MessageDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
