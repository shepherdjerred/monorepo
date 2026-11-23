import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { authPost, pollPlexLogin } from "./api.ts";
import { ErrorNotice } from "./components.tsx";
import { classNames } from "./ui/class-names.ts";
import styles from "./login.module.css";

const cx = classNames(styles);

const LoginSchema = z.object({
  id: z.string(),
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
});

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
      return pollPlexLogin(login.id);
    },
    refetchInterval: (query) =>
      query.state.status === "error" ||
      query.state.data?.status === "authenticated"
        ? false
        : 3000,
  });
  return (
    <main className={cx("screen")}>
      <div className={cx("art")} aria-hidden="true">
        <div className={`${cx("filmFrame")} ${cx("frameOne")}`} />
        <div className={`${cx("filmFrame")} ${cx("frameTwo")}`} />
        <span className={cx("star")}>✦</span>
      </div>
      <section className={cx("panel")}>
        <a className={cx("brand")} href="/">
          <span className={cx("brandMark")} aria-hidden="true">
            m
          </span>{" "}
          media<span className={cx("brandDot")}>.</span>
        </a>
        <h1>
          Your next watch.
          <br />
          <em>All in one place.</em>
        </h1>
        <p className={cx("description")}>
          Request a film. Follow a series. Find out when it’s ready. Your
          household’s library, with everything taken care of.
        </p>
        {login === undefined || poll.isError ? (
          <button
            className={`button primary ${cx("signIn")}`}
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
              className={`button primary ${cx("signIn")}`}
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
        <p className={cx("note")}>
          For members of this Plex library. Your Plex password stays with Plex.
        </p>
      </section>
    </main>
  );
}
