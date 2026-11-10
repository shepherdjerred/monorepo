import { useState } from "react";
import { useSearchParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { Modal, priorities } from "#client/ui/ui.tsx";

export function FilterMenu({
  bootstrap,
  teamKey,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const team = bootstrap.teams.find((item) => item.key === teamKey);
  function change(key: string, values: string[]) {
    const next = new URLSearchParams(params);
    next.delete(key);
    for (const value of values) {
      next.append(key, value);
    }
    setParams(next, { preventScrollReset: true });
  }
  const groups = [
    {
      key: "state",
      name: "Statuses",
      values: bootstrap.states
        .filter((item) => item.teamId === team?.id)
        .map((item) => item.name),
    },
    {
      key: "label",
      name: "Labels (match all)",
      values: bootstrap.labels
        .filter((item) => item.teamId === team?.id)
        .map((item) => item.name),
    },
  ];
  return (
    <>
      <button
        className="text-button"
        onClick={() => {
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={14} />
        Filters
      </button>
      <Modal
        title="Filter issues"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        <div className="metadata-grid">
          {groups.map((group) => (
            <fieldset key={group.key}>
              <legend>{group.name}</legend>
              {group.values.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={params.getAll(group.key).includes(value)}
                    onChange={(event) => {
                      change(
                        group.key,
                        event.target.checked
                          ? [...params.getAll(group.key), value]
                          : params
                              .getAll(group.key)
                              .filter((item) => item !== value),
                      );
                    }}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <label>
          Priority
          <select
            value={params.get("priority") ?? ""}
            onChange={(event) => {
              change(
                "priority",
                event.target.value === "" ? [] : [event.target.value],
              );
            }}
          >
            <option value="">All priorities</option>
            {priorities.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {[
          { key: "assignee", name: "Assignee" },
          { key: "creator", name: "Creator" },
        ].map((group) => (
          <label key={group.key}>
            {group.name}
            <select
              value={params.get(group.key) ?? ""}
              onChange={(event) => {
                change(
                  group.key,
                  event.target.value === "" ? [] : [event.target.value],
                );
              }}
            >
              <option value="">Anyone</option>
              {bootstrap.actors.map((actor) => (
                <option key={actor.key} value={actor.key}>
                  {actor.name} · {actor.key}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="actions">
          <button
            onClick={() => {
              setParams(new URLSearchParams({ team: teamKey }), {
                preventScrollReset: true,
              });
            }}
          >
            Clear filters
          </button>
          <button
            className="primary"
            onClick={() => {
              setOpen(false);
            }}
          >
            Done
          </button>
        </div>
      </Modal>
    </>
  );
}
