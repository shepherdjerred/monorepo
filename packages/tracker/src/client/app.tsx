import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Plus, Search } from "lucide-react";
import { api, type BootstrapData, type Issue } from "./api.ts";
import { Empty, ErrorNotice, Modal } from "./ui.tsx";
import { NewIssue } from "./issue-form.tsx";
import { IssueDetail } from "./issue-detail.tsx";
import { Palette } from "./palette.tsx";
import { Settings, applyTheme, type Theme } from "./settings.tsx";
import { Projects, GlobalActivity, Actors } from "./pages.tsx";
import { Sidebar, BottomNavigation } from "./navigation.tsx";
import { IssueView, useIssueView } from "./issue-view.tsx";
import { shortcutHelp, useShortcuts } from "./shortcuts.ts";

function focusProperty(property: string) {
  const element = document.querySelector(`#${property}`);
  if (element instanceof HTMLSelectElement) {
    element.focus();
    element.showPicker();
  } else element?.querySelector("input")?.focus();
}
function initialTheme(): Theme {
  const saved = localStorage.getItem("tracker.theme");
  const value = saved === "light" || saved === "dark" ? saved : "system";
  applyTheme(value);
  return value;
}
function pageHeading(
  page: string,
  slug: string | undefined,
  data: BootstrapData | undefined,
) {
  return slug === undefined
    ? `${page.slice(0, 1).toUpperCase()}${page.slice(1)}`
    : (data?.projects.find((project) => project.slug === slug)?.name ?? slug);
}

export function App() {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.meta.bootstrap.query(),
  });
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [peek, setPeek] = useState<string>();
  const [selected, setSelected] = useState(0);
  const page = location.pathname.split("/")[1] ?? "issues";
  const identifier =
    page === "issues" ? location.pathname.split("/")[2] : undefined;
  const projectSlug =
    page === "projects" ? location.pathname.split("/")[2] : undefined;
  const issues = useIssueView(page, projectSlug);
  const items = issues.data?.items ?? [];
  function go(to: string) {
    setPeek(undefined);
    void navigate(to);
  }
  function adjacent(delta: number) {
    const index = items.findIndex(
      (item) => item.identifier === (peek ?? identifier),
    );
    const next = items[index + delta];
    if (next === undefined) return;
    if (peek === undefined) go(`/issues/${next.identifier}`);
    else setPeek(next.identifier);
  }
  const actions: Record<string, () => void> = {
    palette: () => {
      setPalette((value) => !value);
    },
    c: () => {
      setCreate(true);
    },
    "?": () => {
      setHelp(true);
    },
    "/": () =>
      document.querySelector<HTMLInputElement>("#issue-search")?.focus(),
    j: () => {
      setSelected((value) => Math.min(items.length - 1, value + 1));
    },
    k: () => {
      setSelected((value) => Math.max(0, value - 1));
    },
    Enter: () => {
      setPeek(items[selected]?.identifier);
    },
    Escape: () => {
      setPeek(undefined);
      if (identifier !== undefined) go("/issues");
    },
    gi: () => {
      go("/issues");
    },
    gb: () => {
      go("/board");
    },
    gp: () => {
      go("/projects");
    },
    ga: () => {
      go("/activity");
    },
    gm: () => {
      go("/issues?mine=true");
    },
    "[": () => {
      adjacent(-1);
    },
    "]": () => {
      adjacent(1);
    },
    s: () => {
      focusProperty("property-state");
    },
    p: () => {
      focusProperty("property-priority");
    },
    P: () => {
      focusProperty("property-project");
    },
    a: () => {
      focusProperty("property-assignee");
    },
    l: () => {
      focusProperty("property-labels");
    },
    v: () => document.querySelector<HTMLButtonElement>("#issue-vote")?.click(),
    e: () =>
      document.querySelector<HTMLButtonElement>("#edit-description")?.click(),
  };
  const onKeyDown = useShortcuts(
    (key) => actions[key]?.(),
    create || palette || help,
  );
  const data = bootstrap.data;
  const heading = pageHeading(page, projectSlug, data);
  const newIssue = () => {
    setCreate(true);
  };
  return (
    <div className="app-shell" ref={onKeyDown}>
      <Sidebar
        bootstrap={data}
        teamKey={params.get("team") ?? "AI"}
        create={newIssue}
        search={() => {
          setPalette(true);
        }}
        help={() => {
          setHelp(true);
        }}
      />
      <main className="main-content">
        <header className="page-header">
          <div>
            <span className="breadcrumb">
              Workspace <span>/</span>
            </span>
            <h1>{identifier ?? heading}</h1>
          </div>
          <span className="spacer" />
          <button
            className="mobile-search icon-button"
            aria-label="Search"
            onClick={() => {
              setPalette(true);
            }}
          >
            <Search size={18} />
          </button>
          <button
            className="primary"
            disabled={data?.writesEnabled !== true}
            onClick={newIssue}
          >
            <Plus size={15} />
            <span>New issue</span>
          </button>
        </header>
        {bootstrap.error !== null && <ErrorNotice error={bootstrap.error} />}
        {data === undefined ? (
          <div className="loading">Loading workspace…</div>
        ) : (
          <>
            {!data.writesEnabled && (
              <div className="banner">
                Tracker is read-only while migration is in progress.
              </div>
            )}
            <PageContent
              page={page}
              bootstrap={data}
              theme={theme}
              setTheme={setTheme}
              identifier={identifier}
              projectSlug={projectSlug}
              items={items}
              selected={selected}
              select={setSelected}
              open={setPeek}
              create={newIssue}
              loading={issues.isPending}
              error={issues.error}
            />
            <NewIssue
              open={create}
              close={() => {
                setCreate(false);
              }}
              bootstrap={data}
              onCreated={(value) => {
                go(`/issues/${value}`);
              }}
            />
            <Modal
              title={peek ?? "Issue"}
              open={peek !== undefined}
              onClose={() => {
                setPeek(undefined);
              }}
              className="peek"
            >
              {peek !== undefined && (
                <IssueDetail
                  identifier={peek}
                  bootstrap={data}
                  peek
                  close={() => {
                    setPeek(undefined);
                  }}
                />
              )}
            </Modal>
          </>
        )}
        {palette && (
          <Palette
            currentIssue={peek ?? identifier}
            action={(key) => actions[key]?.()}
            close={() => {
              setPalette(false);
            }}
            navigate={go}
            create={newIssue}
          />
        )}
        <Modal
          title="Keyboard shortcuts"
          open={help}
          onClose={() => {
            setHelp(false);
          }}
        >
          <dl className="shortcut-list">
            {shortcutHelp.map(([keys, description]) => (
              <div key={keys}>
                <dt>{description}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      </main>
      <BottomNavigation />
    </div>
  );
}

type PageProps = {
  page: string;
  bootstrap: BootstrapData;
  theme: Theme;
  setTheme: (value: Theme) => void;
  identifier: string | undefined;
  projectSlug: string | undefined;
  items: Issue[];
  selected: number;
  select: (index: number) => void;
  open: (value: string) => void;
  create: () => void;
  loading: boolean;
  error: unknown;
};
function PageContent(props: PageProps) {
  if (props.identifier !== undefined)
    return (
      <IssueDetail identifier={props.identifier} bootstrap={props.bootstrap} />
    );
  if (
    ["issues", "board"].includes(props.page) ||
    (props.page === "projects" && props.projectSlug !== undefined)
  )
    return <IssueView {...props} />;
  if (props.page === "projects")
    return <Projects bootstrap={props.bootstrap} />;
  if (props.page === "actors") return <Actors />;
  if (props.page === "activity") return <GlobalActivity />;
  return props.page === "settings" ? (
    <Settings
      bootstrap={props.bootstrap}
      theme={props.theme}
      setTheme={props.setTheme}
    />
  ) : (
    <Empty title="Page not found">
      <Link to="/issues">Back to issues</Link>
    </Empty>
  );
}
