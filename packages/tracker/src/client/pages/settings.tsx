import { useState } from "react";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { api, refresh, type BootstrapData } from "#client/data/api.ts";
import { ActorSchema } from "#shared/actor.ts";
import { StateTypeSchema } from "#shared/schema.ts";
import { currentActor, saveActor } from "#client/data/identity.ts";
import { ErrorNotice, Swatch } from "#client/ui/ui.tsx";
import { announce } from "#client/shell/announce.tsx";

const ThemeSchema = z.enum(["system", "light", "dark"]);
type Theme = z.infer<typeof ThemeSchema>;
// The page background of each scheme; the browser tints its chrome with it.
const themeColors = { light: "#ffffff", dark: "#1b1b1f" };

/**
 * The only writer of the saved theme. `index.html` reads the same key before
 * first paint so an explicit choice never flashes the other scheme.
 */
function applyTheme(theme: Theme) {
  document.documentElement.dataset["theme"] = theme;
  localStorage.setItem("tracker.theme", theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = themeColors[theme === "system" ? scheme : theme];
  }
}
export function Settings({
  bootstrap,
  teamKey: currentTeamKey,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = ThemeSchema.safeParse(localStorage.getItem("tracker.theme"));
    return saved.success ? saved.data : "system";
  });
  const actor = currentActor();
  const [key, setKey] = useState(actor.key);
  const [name, setName] = useState(actor.name);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>();
  const [teamKey, setTeam] = useState(currentTeamKey);
  const [labelName, setLabelName] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [projectName, setProjectName] = useState("");
  const [slug, setSlug] = useState("");
  const [stateName, setStateName] = useState("");
  const [stateType, setStateType] = useState("unstarted");
  const label = useMutation({
    mutationFn: () =>
      api.labels.create.mutate({
        actor: currentActor(),
        teamKey,
        name: labelName,
        color,
      }),
    onSuccess: () => {
      setLabelName("");
      announce("Label created");
      void refresh();
    },
  });
  const project = useMutation({
    mutationFn: () =>
      api.projects.create.mutate({
        actor: currentActor(),
        slug,
        name: projectName,
        color,
      }),
    onSuccess: () => {
      setProjectName("");
      setSlug("");
      announce("Project created");
      void refresh();
    },
  });
  const state = useMutation({
    mutationFn: () =>
      api.states.create.mutate({
        actor: currentActor(),
        teamKey,
        name: stateName,
        color,
        type: StateTypeSchema.parse(stateType),
        position: bootstrap.states.length,
      }),
    onSuccess: () => {
      setStateName("");
      announce("State created");
      void refresh();
    },
  });
  const deleteLabel = useMutation({
    mutationFn: (labelToDelete: string) =>
      api.labels.delete.mutate({
        actor: currentActor(),
        teamKey,
        name: labelToDelete,
      }),
    onSuccess: () => {
      void refresh();
    },
  });
  const archiveProject = useMutation({
    mutationFn: (projectToArchive: string) =>
      api.projects.archive.mutate({
        actor: currentActor(),
        slug: projectToArchive,
      }),
    onSuccess: () => {
      void refresh();
    },
  });
  return (
    <div className="settings-page">
      <section>
        <h2>Appearance</h2>
        <p className="muted">Choose how Tracker looks on this device.</p>
        <div className="theme-options">
          {(["system", "light", "dark"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={theme === value}
              className={theme === value ? "selected" : ""}
              onClick={() => {
                applyTheme(value);
                setTheme(value);
              }}
            >
              <div
                className={`theme-preview theme-${value}`}
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
              </div>
              {value[0]?.toUpperCase()}
              {value.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Your identity</h2>
        <p className="muted">
          Changes are attributed to this actor. Tracker is private to the
          tailnet and does not use accounts.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              saveActor(ActorSchema.parse({ key, name, kind: actor.kind }));
              setError(undefined);
              setNotice("Identity saved");
              announce("Identity saved");
            } catch (error_) {
              setError(error_);
            }
          }}
        >
          <label>
            Name
            <input
              value={name}
              required
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <label>
            Actor key
            <input
              value={key}
              required
              onChange={(e) => {
                setKey(e.target.value);
              }}
            />
          </label>
          <button className="primary">Save identity</button>
          {notice !== "" && <p>{notice}</p>}
          {error !== undefined && <ErrorNotice error={error} />}
        </form>
      </section>
      <section>
        <h2>Workspace</h2>
        <div className="form-selects">
          <label>
            Team
            <select
              value={teamKey}
              onChange={(e) => {
                setTeam(e.target.value);
              }}
            >
              {bootstrap.teams.map((team) => (
                <option key={team.id} value={team.key}>
                  {team.name} ({team.key})
                </option>
              ))}
            </select>
          </label>
          <label>
            Color
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
              }}
            />
          </label>
        </div>
        <h3>Labels</h3>
        <div className="catalog-list">
          {bootstrap.labels
            .filter(
              (l) =>
                l.teamId === bootstrap.teams.find((t) => t.key === teamKey)?.id,
            )
            .map((l) => (
              <div key={l.id}>
                <span>
                  <Swatch color={l.color} />
                  {l.name}
                </span>
                <button
                  disabled={!bootstrap.writesEnabled}
                  className="text-button danger"
                  onClick={() => {
                    deleteLabel.mutate(l.name);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            label.mutate();
          }}
        >
          <input
            aria-label="New label name"
            placeholder="Label name"
            required
            value={labelName}
            onChange={(e) => {
              setLabelName(e.target.value);
            }}
          />
          <button disabled={!bootstrap.writesEnabled || label.isPending}>
            Create label
          </button>
        </form>
        <h3>Workflow states</h3>
        <div className="catalog-list">
          {bootstrap.states
            .filter(
              (s) =>
                s.teamId === bootstrap.teams.find((t) => t.key === teamKey)?.id,
            )
            .map((s) => (
              <div key={s.id}>
                <span>
                  <Swatch color={s.color} />
                  {s.name}
                </span>
                <span className="muted">{s.type}</span>
              </div>
            ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            state.mutate();
          }}
        >
          <input
            aria-label="New state name"
            placeholder="State name"
            required
            value={stateName}
            onChange={(e) => {
              setStateName(e.target.value);
            }}
          />
          <select
            aria-label="State type"
            value={stateType}
            onChange={(e) => {
              setStateType(e.target.value);
            }}
          >
            {StateTypeSchema.options.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <button disabled={!bootstrap.writesEnabled || state.isPending}>
            Create state
          </button>
        </form>
        <h3>Projects</h3>
        <div className="catalog-list">
          {bootstrap.projects.map((p) => (
            <div key={p.id}>
              <span>
                <Swatch color={p.color} />
                {p.name}
                {p.archivedAt === null ? "" : " · archived"}
              </span>
              {p.archivedAt === null && (
                <button
                  disabled={!bootstrap.writesEnabled}
                  className="text-button"
                  onClick={() => {
                    archiveProject.mutate(p.slug);
                  }}
                >
                  Archive
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            project.mutate();
          }}
        >
          <input
            aria-label="Project name"
            placeholder="Project name"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value);
            }}
            required
          />
          <input
            aria-label="Project slug"
            placeholder="project-slug"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
            }}
            required
          />
          <button disabled={!bootstrap.writesEnabled || project.isPending}>
            Create project
          </button>
        </form>
        {[
          label.error,
          project.error,
          state.error,
          deleteLabel.error,
          archiveProject.error,
        ]
          .filter((e) => e !== null)
          .map((e, i) => (
            <ErrorNotice error={e} key={i} />
          ))}
      </section>
    </div>
  );
}
