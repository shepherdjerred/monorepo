import { useState } from "react";
import { flushSync } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import type { BootstrapData } from "#client/data/api.ts";
import {
  archiveProject,
  createLabel,
  createProject,
  createState,
  deleteLabel,
} from "#client/data/catalog-mutations.ts";
import { ActorSchema } from "#shared/actor.ts";
import { StateTypeSchema } from "#shared/schema.ts";
import { currentActor, saveActor } from "#client/data/identity.ts";
import { ErrorNotice, Swatch } from "#client/ui/ui.tsx";
import { notify } from "#client/ui/toast.tsx";
import { applyTheme, savedTheme, type Theme } from "#client/ui/theme.ts";
import { FeedbackSettings } from "#client/feedback/feedback-settings.tsx";
import { originOf, revealTheme } from "#client/feedback/motion.ts";

export function Settings({
  bootstrap,
  teamKey: currentTeamKey,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
}) {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const actor = currentActor();
  const [key, setKey] = useState(actor.key);
  const [name, setName] = useState(actor.name);
  const [error, setError] = useState<unknown>();
  const [teamKey, setTeam] = useState(currentTeamKey);
  const [labelName, setLabelName] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [projectName, setProjectName] = useState("");
  const [slug, setSlug] = useState("");
  const [stateName, setStateName] = useState("");
  const [stateType, setStateType] = useState("unstarted");
  // Each change shows in the catalog at once; a refused one is taken back,
  // reported as a toast, and leaves the form filled in to try again.
  const label = useMutation({
    mutationFn: () => createLabel({ teamKey, name: labelName, color }),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        setLabelName("");
      }
    },
  });
  const project = useMutation({
    mutationFn: () => createProject({ slug, name: projectName, color }),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        setProjectName("");
        setSlug("");
      }
    },
  });
  const state = useMutation({
    mutationFn: () =>
      createState({
        teamKey,
        name: stateName,
        color,
        type: StateTypeSchema.parse(stateType),
        position: bootstrap.states.length,
      }),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        setStateName("");
      }
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
              onClick={(event) => {
                // The new theme spreads from the button that chose it.
                revealTheme(() => {
                  applyTheme(value);
                  flushSync(() => {
                    setTheme(value);
                  });
                }, originOf(event));
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
      <FeedbackSettings />
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
              notify("Identity saved");
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
                    void deleteLabel(teamKey, l);
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
                    void archiveProject(p);
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
      </section>
    </div>
  );
}
