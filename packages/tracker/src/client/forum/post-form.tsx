import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ErrorNotice } from "#client/ui/ui.tsx";
import { useRefreshForum, type Post } from "./data.ts";
const Kind = z.enum(["notice", "discussion"]);
function initialValues(post?: Post) {
  return {
    kind: post?.kind ?? "notice",
    title: post?.title ?? "",
    body: post?.body ?? "",
    scopes: post?.scopes.join(", ") ?? "",
    condition: post?.exitCondition ?? "",
    expires: post?.expiresAt ?? "",
  };
}
export function PostForm({
  post,
  close,
  created,
}: {
  post?: Post;
  close: () => void;
  created?: (id: string) => void;
}) {
  const initial = initialValues(post);
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [scopes, setScopes] = useState(initial.scopes);
  const [condition, setCondition] = useState(initial.condition);
  const [expires, setExpires] = useState(initial.expires);
  const [revision, setRevision] = useState(post?.revision);
  const refresh = useRefreshForum();
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        title,
        body,
        scopes: scopes
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
        exitCondition: kind === "notice" ? condition : null,
        expiresAt: kind === "notice" && expires.trim() !== "" ? expires : null,
      };
      if (post !== undefined && revision !== undefined) {
        return api.forum.update.mutate({
          actor: currentActor(),
          id: post.id,
          expectedRevision: revision,
          ...fields,
        });
      }
      return api.forum.create.mutate({
        actor: currentActor(),
        kind,
        ...fields,
      });
    },
    onSuccess: async (value) => {
      await refresh();
      created?.(value.id);
      close();
    },
    onError: () => {
      void refresh();
    },
  });
  return (
    <form
      className="forum-form"
      aria-label={post === undefined ? "New forum post" : "Edit forum post"}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>{post === undefined ? "New post" : "Edit post"}</h2>
      <fieldset disabled={save.isPending}>
        <legend>Post details</legend>
        <p className="muted">
          Title, body, and a notice’s exit condition are required. Markdown is
          supported.
        </p>
        {post === undefined && (
          <label>
            Post type
            <select
              value={kind}
              onChange={(event) => {
                setKind(Kind.parse(event.target.value));
              }}
            >
              <option value="notice">Notice</option>
              <option value="discussion">Discussion</option>
            </select>
          </label>
        )}
        <label>
          Title
          <input
            required
            maxLength={500}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <label>
          Body
          <textarea
            required
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
        </label>
        <label>
          Scopes
          <input
            value={scopes}
            placeholder="main, ci, cluster"
            onChange={(event) => {
              setScopes(event.target.value);
            }}
          />
          <span className="muted">
            Comma-separated tags. Leave empty to apply globally.
          </span>
        </label>
        {kind === "notice" && (
          <>
            <label>
              Exit condition
              <textarea
                required
                value={condition}
                onChange={(event) => {
                  setCondition(event.target.value);
                }}
              />
            </label>
            <label>
              Expires at
              <input
                value={expires}
                placeholder="2026-12-01T12:00:00Z"
                onChange={(event) => {
                  setExpires(event.target.value);
                }}
              />
              <span className="muted">
                Optional ISO timestamp with timezone. Expiration hides this
                notice from the active feed; it does not perform cleanup.
              </span>
            </label>
          </>
        )}
        <div className="forum-actions">
          <button className="primary" type="submit">
            {save.isPending ? "Saving…" : "Save post"}
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </fieldset>
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.error !== null && post !== undefined && (
        <button
          type="button"
          onClick={() => {
            setRevision(post.revision);
            save.reset();
          }}
        >
          Use latest revision after reviewing changes
        </button>
      )}
    </form>
  );
}
