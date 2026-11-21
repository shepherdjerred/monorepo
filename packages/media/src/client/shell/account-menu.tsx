import { useId, useState } from "react";
import {
  BellIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NOTIFICATION_SETTINGS_PATH } from "#client/notifications/paths.ts";
import { chooseTheme, useThemeChoice, type ThemeChoice } from "./theme.ts";
import { classNames } from "#client/ui/class-names.ts";
import { useDismissal } from "#client/ui/use-dismissal.ts";
import styles from "./account-menu.module.css";

const cx = classNames(styles);

const THEMES: readonly {
  value: ThemeChoice;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

/**
 * The account button and the panel it discloses: who is signed in, the
 * theme, the two personal pages, and sign out.
 *
 * It is a disclosure, not an ARIA menu: the panel holds links and a radio
 * group, which people move through with Tab. Escape closes it and returns
 * focus to the button; a press or focus anywhere else closes it.
 */
export function AccountMenu({
  user,
  signingOut,
  onSignOut,
}: {
  user: MediaUser;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const themeName = useId();
  const hintId = useId();
  const theme = useThemeChoice();

  // Following a link in the panel closes it.
  const { key } = useLocation();
  const [openedAt, setOpenedAt] = useState(key);
  if (openedAt !== key) {
    setOpenedAt(key);
    setOpen(false);
  }

  const dismissal = useDismissal(open, setOpen);

  return (
    <div className={cx("root")} ref={dismissal}>
      <button
        className={cx("trigger")}
        type="button"
        aria-label="Account"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((shown) => !shown);
        }}
      >
        <span aria-hidden="true">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
      </button>
      <div className={cx("panel")} id={panelId} hidden={!open}>
        <p className={cx("identity")}>
          <strong>{user.displayName}</strong>
          <span>
            {user.role === "owner" ? "Library owner" : "Library member"}
          </span>
        </p>
        <div className={cx("themeSection")}>
          <fieldset className={cx("theme")} aria-describedby={hintId}>
            <legend>Theme</legend>
            <div className={cx("themeOptions")}>
              {THEMES.map((option) => (
                <label className={cx("themeOption")} key={option.value}>
                  <input
                    className="sr-only"
                    type="radio"
                    name={themeName}
                    value={option.value}
                    checked={theme === option.value}
                    onChange={() => {
                      chooseTheme(option.value);
                    }}
                  />
                  <option.icon aria-hidden="true" />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className={cx("themeHint")} id={hintId}>
            {theme === "system" ? (
              <>
                Matches this device, which is{" "}
                <span className={cx("whenLight")}>light</span>
                <span className={cx("whenDark")}>dark</span> right now.
              </>
            ) : (
              `Stays ${theme} whatever this device is set to.`
            )}
          </p>
        </div>
        <ul className={cx("links")}>
          <li>
            <Link className={cx("item")} to={NOTIFICATION_SETTINGS_PATH}>
              <BellIcon aria-hidden="true" />
              Notification settings
            </Link>
          </li>
          <li>
            <Link className={cx("item")} to="/recovery">
              <ShieldCheckIcon aria-hidden="true" />
              Recovery reviews
            </Link>
          </li>
        </ul>
        <button
          className={cx("item")}
          type="button"
          disabled={signingOut}
          onClick={onSignOut}
        >
          <LogOutIcon aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
