import { useMutation } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router";
import { CommandResultSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./notifications.module.css";
import { NOTIFICATION_SETTINGS_PATH } from "./paths.ts";
import { PREFERENCES_KEY } from "./settings.tsx";

const cx = classNames(styles);

const COPY = {
  email: {
    title: "Confirm your email address",
    about:
      "Confirming tells Media this address is yours, so it can write to you there.",
    action: "Confirm email address",
    working: "Confirming…",
    done: "Email address confirmed.",
  },
  discord: {
    title: "Connect your Discord account",
    about:
      "Connecting lets Media send you a direct message on Discord, as the account you just chose there.",
    action: "Connect Discord",
    working: "Connecting…",
    done: "Discord connected.",
  },
} as const;

/**
 * Where a verification email's link and Discord's return both land. The
 * address carries the proof (a token in the fragment, or Discord's code);
 * nothing is sent to Media until the reader confirms, so opening the link by
 * accident, or a mail scanner opening it, changes nothing.
 */
export function NotificationCallback({
  user,
  channel,
}: {
  user: MediaUser;
  channel: "email" | "discord";
}) {
  const [parameters] = useSearchParams();
  const location = useLocation();
  const copy = COPY[channel];
  const confirm = useMutation({
    mutationFn: async () =>
      channel === "email"
        ? writeApi({
            actorId: user.id,
            path: "/notifications/email/verify",
            body: {
              token: new URLSearchParams(location.hash.slice(1)).get("verify"),
            },
            schema: CommandResultSchema,
          })
        : writeApi({
            actorId: user.id,
            path: "/notifications/discord/complete",
            body: {
              code: parameters.get("code"),
              state: parameters.get("state"),
              issuer: parameters.get("iss"),
            },
            schema: CommandResultSchema,
          }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY }),
  });
  return (
    <>
      <PageTitle title={copy.title}>
        <p>{copy.about}</p>
      </PageTitle>
      {confirm.isSuccess ? (
        <div className={cx("callbackDone")} role="status">
          <p>{copy.done}</p>
          <Link className="button" to={NOTIFICATION_SETTINGS_PATH}>
            Notification settings
          </Link>
        </div>
      ) : (
        <div className={cx("callbackAction")}>
          <button
            className="button primary"
            type="button"
            disabled={confirm.isPending}
            onClick={() => {
              confirm.mutate();
            }}
          >
            {confirm.isPending ? copy.working : copy.action}
          </button>
        </div>
      )}
      {confirm.error !== null && (
        <p className={cx("formError")} role="alert">
          {confirm.error.message}
        </p>
      )}
    </>
  );
}
