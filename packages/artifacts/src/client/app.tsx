import { AppSwitcher, ThemeToggle } from "@shepherdjerred/console-ui";
import { KeyboardIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Route, Routes, useMatch } from "react-router";
import { BoardPage } from "./pages/board.tsx";
import { FocusedPage } from "./pages/focused.tsx";
import { InboxPage } from "./pages/inbox.tsx";
import { OutlinePage } from "./pages/outline.tsx";
import { CURRENT_APP, SWITCHER_APPS } from "./shell/app-nav.ts";
import { ShellContext } from "./shell/shell-context.tsx";
import { ShortcutSheet } from "./shell/shortcut-sheet.tsx";
import { useShortcuts } from "./shell/shortcuts.ts";
import { themeStore } from "./shell/theme.ts";

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
  const focused = useMatch("/a/:artifactId");
  // The canvas and the focused view are full-bleed: their own floating nav
  // replaces the shell bar. The inbox and the outline keep the bar.
  const fullBleed = board !== null || focused !== null;
  const shell = useMemo(
    () => ({
      openShortcuts: () => {
        setSheet(true);
      },
    }),
    [],
  );
  useShortcuts([
    {
      key: "?",
      run: () => {
        setSheet((value) => !value);
      },
    },
  ]);

  return (
    <ShellContext value={shell}>
      {board?.params.slug === undefined ? (
        <a className="skip-link" href="#content">
          Skip to content
        </a>
      ) : (
        <Link className="skip-link" to={`/b/${board.params.slug}/outline`}>
          Review this board as a list
        </Link>
      )}
      {fullBleed ? null : (
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
      )}
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
    </ShellContext>
  );
}
