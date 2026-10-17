import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { UserSchema } from "#shared/contract.ts";
import { authPost, queryClient } from "./api.ts";
import { ErrorNotice } from "./components.tsx";

const LoginSchema = z.object({
  id: z.string(),
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
const PollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("authenticated"),
    user: UserSchema,
    csrfToken: z.string(),
  }),
]);

export function Login() {
  const start = useMutation({
    mutationFn: async () => authPost("/plex/start", LoginSchema),
  });
  const login = start.data;
  const poll = useQuery({
    queryKey: ["plex-login", login?.id],
    enabled: login !== undefined,
    queryFn: async () => {
      if (login === undefined) throw new Error("Sign-in was not started");
      const result = await authPost(
        `/plex/poll/${encodeURIComponent(login.id)}`,
        PollSchema,
      );
      if (result.status === "authenticated")
        queryClient.setQueryData(["me"], result.user);
      return result;
    },
    refetchInterval: (query) =>
      query.state.status === "error" ||
      query.state.data?.status === "authenticated"
        ? false
        : 3000,
  });
  return (
    <main className="login-screen">
      <div className="login-art" aria-hidden="true">
        <div className="film-frame frame-one" />
        <div className="film-frame frame-two" />
        <span className="login-star">✦</span>
      </div>
      <section className="login-panel">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            m
          </span>{" "}
          media<span className="brand-dot">.</span>
        </a>
        <p className="eyebrow">A good night starts here</p>
        <h1>
          Your next watch.
          <br />
          <em>All in one place.</em>
        </h1>
        <p className="login-description">
          Request a film. Follow a series. Find out when it’s ready. Your
          household’s library, with everything taken care of.
        </p>
        {login === undefined || poll.isError ? (
          <button
            className="button primary large"
            disabled={start.isPending}
            onClick={() => {
              start.mutate();
            }}
          >
            {start.isPending ? "Connecting to Plex…" : "Sign in with Plex"}
            <span aria-hidden="true">→</span>
          </button>
        ) : (
          <>
            <a
              className="button primary large"
              href={login.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Continue to Plex <span aria-hidden="true">↗</span>
            </a>
            <p className="helper" role="status">
              Finish signing in in the Plex tab. This page will update
              automatically.
            </p>
          </>
        )}
        {start.error !== null && <ErrorNotice error={start.error} />}
        {poll.error !== null && <ErrorNotice error={poll.error} />}
        <p className="login-note">
          For members of this Plex library. Your Plex password stays with Plex.
        </p>
      </section>
    </main>
  );
}
