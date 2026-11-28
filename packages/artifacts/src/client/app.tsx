import {
  AppSwitcher,
  ThemeToggle,
  type AppSwitcherEntry,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import { KeyboardIcon } from "lucide-react";
import { useState } from "react";
import { Link, Route, Routes, useMatch } from "react-router";
import { BoardPage } from "./pages/board.tsx";
import { FocusedPage } from "./pages/focused.tsx";
import { InboxPage } from "./pages/inbox.tsx";
import { OutlinePage } from "./pages/outline.tsx";
import { ShortcutSheet } from "./shell/shortcut-sheet.tsx";
import { useShortcuts } from "./shell/shortcuts.ts";
import { themeStore } from "./shell/theme.ts";

const CURRENT_APP = { label: "Artifacts", mark: "A" } as const;
const SWITCHER_APPS: readonly AppSwitcherEntry[] = [
  { label: "Artifacts", url: "/", group: "Apps" },
  ...CONSOLE_LINKS.filter((link) => link.label !== "Artifacts").map((link) => ({
    label: link.label,
    url: link.url,
    group: link.group,
  })),
];

function NotFound(): React.JSX.Element {
  return (
    <main className="ar-page" id="content" tabIndex={-1}>
      <title>Not found · Artifacts</title>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the inbox</Link>
      </p>
    </main>
  );
}

export function App(): React.JSX.Element {
  const [sheet, setSheet] = useState(false);
  const board = useMatch("/b/:slug");
  useShortcuts([
    {
      key: "?",
      run: () => {
        setSheet((value) => !value);
      },
    },
  ]);

  return (
    <>
      {board?.params.slug === undefined ? (
        <a className="skip-link" href="#content">
          Skip to content
        </a>
      ) : (
        <Link className="skip-link" to={`/b/${board.params.slug}/outline`}>
          Review this board as a list
        </Link>
      )}
      <header className="ar-top">
        <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
        <nav aria-label="Primary" className="ar-top-nav">
          <Link to="/">Inbox</Link>
        </nav>
        <span className="ar-grow" />
        <button
          type="button"
          className="ar-icon-button"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
          onClick={() => {
            setSheet(true);
          }}
        >
          <KeyboardIcon aria-hidden="true" />
        </button>
        <ThemeToggle store={themeStore} />
      </header>
      <Routes>
        <Route path="/" element={<InboxPage />} />
        <Route path="/a/:artifactId" element={<FocusedPage />} />
        <Route path="/b/:slug" element={<BoardPage />} />
        <Route path="/b/:slug/outline" element={<OutlinePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <ShortcutSheet
        open={sheet}
        onClose={() => {
          setSheet(false);
        }}
      />
    </>
  );
}
