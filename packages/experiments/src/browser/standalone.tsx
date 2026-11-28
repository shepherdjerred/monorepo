import "@shepherdjerred/console-ui/styles/index.css";
import {
  AppSwitcher,
  ShellFrame,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  TopBar,
  createThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router";

import { EXPERIMENTS_API_PATH } from "@shepherdjerred/experiments/contract";
import { ExperimentDetailPage } from "./detail-page.tsx";
import { NewExperimentPage } from "./draft-page.tsx";
import { ExperimentsListPage } from "./list-page.tsx";
import { EXPERIMENTS_PATH, NEW_EXPERIMENT_PATH } from "./presentation.tsx";

const theme = createThemeStore("experiments-theme");
const queryClient = new QueryClient();

function Switcher() {
  return (
    <AppSwitcher
      current={{ label: "Experiments", mark: "E" }}
      apps={CONSOLE_LINKS}
    />
  );
}

function ExperimentsNav({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <SidebarGroup label="Ops">
      <SidebarItem
        href={EXPERIMENTS_PATH}
        label="Experiments"
        icon={FlaskConicalIcon}
        current
        renderLink={({ href, ...props }) => (
          <NavLink to={href} {...props} onClick={onNavigate} />
        )}
      />
    </SidebarGroup>
  );
}

function StandaloneExperiments() {
  return (
    <ShellFrame
      sidebar={
        <Sidebar
          label="Experiments"
          navLabel="Experiments navigation"
          top={<Switcher />}
          footer={<ThemeRow store={theme} />}
        >
          <ExperimentsNav />
        </Sidebar>
      }
    >
      <TopBar
        switcher={<Switcher />}
        brand="Experiments"
        navLabel="Experiments navigation"
        theme={theme}
      >
        {(close) => <ExperimentsNav onNavigate={close} />}
      </TopBar>
      <Routes>
        <Route path="/" element={<Navigate to={EXPERIMENTS_PATH} replace />} />
        <Route
          path={EXPERIMENTS_PATH}
          element={<ExperimentsListPage api={EXPERIMENTS_API_PATH} />}
        />
        <Route
          path={NEW_EXPERIMENT_PATH}
          element={<NewExperimentPage api={EXPERIMENTS_API_PATH} />}
        />
        <Route
          path={EXPERIMENTS_PATH + "/:id"}
          element={<ExperimentDetailPage api={EXPERIMENTS_API_PATH} />}
        />
      </Routes>
    </ShellFrame>
  );
}

const element = document.querySelector("#root");
if (element === null) throw new Error("Missing Experiments root");
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <StandaloneExperiments />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
