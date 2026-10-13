/** Native shell hooks also run for user terminals, which have no sessionID. */
export const TrackerIdentity = async () => ({
  "shell.env": async (input, output) => {
    if (input.sessionID === undefined) return;
    if (!/^[a-zA-Z0-9_-]+$/u.test(input.sessionID))
      throw new Error("OpenCode did not provide a valid native session ID");
    output.env.TRACKER_ACTOR_HARNESS = "opencode";
    output.env.OPENCODE_SESSION_ID = input.sessionID;
  },
});
