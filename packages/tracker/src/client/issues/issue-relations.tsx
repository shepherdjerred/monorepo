import { useState } from "react";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import type { IssueDetailData } from "#client/data/api.ts";
import { addRelation, removeRelation } from "#client/data/detail-mutations.ts";
import { Modal } from "#client/ui/ui.tsx";

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
  const [saving, setSaving] = useState(false);
  async function add() {
    // A mistyped identifier is common, so the dialog stays until it is saved.
    setSaving(true);
    const outcome = await addRelation(
      issue.identifier,
      target.toUpperCase(),
      type,
    );
    setSaving(false);
    if (outcome.ok) {
      setAdding(false);
      setTarget("");
    }
  }
  return (
    <section className="relations">
      <div className="section-heading">
        <h2>Relations</h2>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => {
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
              disabled={disabled || r.id.startsWith("optimistic-")}
              onClick={() => {
                void removeRelation(r);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
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
            void add();
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
          <div className="actions">
            <button className="primary" disabled={saving}>
              Add relation
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
