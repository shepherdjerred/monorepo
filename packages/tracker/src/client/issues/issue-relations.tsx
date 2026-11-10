import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import { api, refresh, type IssueDetailData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { announce } from "#client/shell/announce.tsx";

const RelationTypeSchema = z.enum([
  "related",
  "blocks",
  "blocked-by",
  "duplicate",
]);

export function IssueRelations({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [type, setType] =
    useState<z.infer<typeof RelationTypeSchema>>("related");
  const add = useMutation({
    mutationFn: () =>
      api.relations.create.mutate({
        actor: currentActor(),
        identifier: issue.identifier,
        target: target.toUpperCase(),
        type,
      }),
    onSuccess: () => {
      setAdding(false);
      setTarget("");
      announce("Relation added");
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.relations.delete.mutate({ actor: currentActor(), id }),
    onSuccess: () => {
      announce("Relation removed");
      void refresh();
    },
  });
  return (
    <section className="relations">
      <div className="section-heading">
        <h2>Relations</h2>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => {
            add.reset();
            setAdding(true);
          }}
        >
          + Add relation
        </button>
      </div>
      {issue.relations.length === 0 && (
        <p className="muted">No related issues</p>
      )}
      {issue.relations.map((r) => {
        const other = r.fromId === issue.id ? r.to : r.from;
        return (
          <div className="relation" key={r.id}>
            <span className="muted">
              {r.type === "blocks" && r.toId === issue.id
                ? "blocked by"
                : r.type}
            </span>
            <Link to={`/issues/${other.identifier}`}>
              <span className="identifier">{other.identifier}</span>{" "}
              {other.title}
            </Link>
            <button
              className="icon-button"
              aria-label={`Remove relation to ${other.identifier}`}
              disabled={disabled}
              onClick={() => {
                remove.mutate(r.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
      {remove.error !== null && <ErrorNotice error={remove.error} />}
      <Modal
        title="Add relation"
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <label>
            Relationship
            <select
              value={type}
              onChange={(e) => {
                setType(RelationTypeSchema.parse(e.target.value));
              }}
            >
              <option value="related">Related to</option>
              <option value="blocks">Blocks</option>
              <option value="blocked-by">Blocked by</option>
              <option value="duplicate">Duplicate of</option>
            </select>
          </label>
          <label>
            Issue identifier
            <input
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
              placeholder="AI-123"
              required
              pattern="[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*"
            />
          </label>
          {add.error !== null && <ErrorNotice error={add.error} />}
          <div className="actions">
            <button className="primary" disabled={add.isPending}>
              Add relation
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
