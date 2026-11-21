import { useState } from "react";
import { CheckIcon, ChevronDownIcon, EllipsisIcon } from "lucide-react";
import type { MediaUser } from "#shared/contract.ts";
import type { SheetSubject } from "#client/request-sheet/form.ts";
import { RequestSheet } from "#client/request-sheet/sheet.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Menu, type MenuItem } from "#client/ui/menu.tsx";
import { CommandFeedback, type CommandRunner } from "./commands.tsx";
import { COMMAND_COPY, type TitleCommand } from "./copy.ts";
import {
  titleActions,
  type MenuAction,
  type PrimaryAction,
  type TitleFacts,
} from "./primary-action.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

/** A standing the reader already has, as the button that opens the way out. */
const STANDING_COPY = {
  following: "Following",
  kept: "Kept for good",
} as const satisfies Partial<Record<PrimaryAction, string>>;

/** The commands among a title's actions, the primary one first. */
function offeredCommands(facts: TitleFacts): TitleCommand[] {
  const { primary, menu } = titleActions(facts);
  return [
    ...(primary === "hold" || primary === "keep" || primary === "restore"
      ? [primary]
      : []),
    ...menu.filter((action) => action !== "request"),
  ];
}

function menuItems(
  menu: readonly MenuAction[],
  input: {
    requestLabel: string;
    onRequest: () => void;
    run: (command: TitleCommand) => void;
  },
): MenuItem[] {
  return menu.map((action) =>
    action === "request"
      ? { key: action, label: input.requestLabel, onSelect: input.onRequest }
      : {
          key: action,
          label: COMMAND_COPY[action].label,
          detail: COMMAND_COPY[action].detail,
          onSelect: () => {
            input.run(action);
          },
        },
  );
}

/**
 * What the reader can do with a title: one main action chosen from where
 * they stand with it, and the rest behind a menu.
 *
 * When the reader already follows the title, or keeps it for good, the main
 * control says so and opens the way to stop. Asking for the title opens the
 * request sheet.
 */
export function TitleActionBar({
  user,
  facts,
  runner,
  subject,
  requestLabel,
  onRequested,
}: {
  user: MediaUser;
  facts: TitleFacts;
  runner: CommandRunner;
  /** What the request sheet asks for. */
  subject: SheetSubject;
  /** What asking is called here: "Request", or asking again in another way. */
  requestLabel: string;
  onRequested?: (outcome: { mediaId: string }) => void;
}) {
  const [asking, setAsking] = useState(false);
  const { primary, menu } = titleActions(facts);
  const items = menuItems(menu, {
    requestLabel,
    onRequest: () => {
      setAsking(true);
    },
    run: runner.run,
  });
  return (
    <div className={cx("actions")}>
      <div className={cx("actionRow")}>
        {primary === "following" || primary === "kept" ? (
          <Standing
            label={STANDING_COPY[primary]}
            items={items}
            disabled={runner.busy}
          />
        ) : (
          <>
            <button
              className="button primary"
              type="button"
              disabled={primary !== "request" && runner.busy}
              onClick={() => {
                if (primary === "request") setAsking(true);
                else runner.run(primary);
              }}
            >
              {primary === "request"
                ? requestLabel
                : runner.pending === primary
                  ? "Saving…"
                  : COMMAND_COPY[primary].label}
            </button>
            {items.length > 0 && (
              <Menu
                label="More actions"
                trigger={<EllipsisIcon aria-hidden="true" />}
                alignEndOnPhone
                disabled={runner.busy}
                items={items}
              />
            )}
          </>
        )}
      </div>
      <CommandFeedback runner={runner} />
      {asking && (
        <RequestSheet
          user={user}
          subject={subject}
          onClose={() => {
            setAsking(false);
          }}
          {...(onRequested === undefined ? {} : { onRequested })}
        />
      )}
    </div>
  );
}

/** Where the reader stands, opening onto the way out when there is one. */
function Standing({
  label,
  items,
  disabled,
}: {
  label: string;
  items: readonly MenuItem[];
  disabled: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className={cx("standing")}>
        <CheckIcon aria-hidden="true" />
        {label}
      </p>
    );
  }
  return (
    <Menu
      variant="standing"
      trigger={
        <>
          <CheckIcon aria-hidden="true" />
          {label}
          <ChevronDownIcon aria-hidden="true" />
        </>
      }
      disabled={disabled}
      items={items}
    />
  );
}

/** The commands of one row of a list, behind a small menu named for the row. */
export function RowActions({
  name,
  facts,
  runner,
}: {
  name: string;
  facts: TitleFacts;
  runner: CommandRunner;
}) {
  const commands = offeredCommands(facts);
  if (commands.length === 0) return null;
  return (
    <Menu
      label={`Actions for ${name}`}
      trigger={<EllipsisIcon aria-hidden="true" />}
      alignEndOnPhone
      disabled={runner.busy}
      items={commands.map((command) => ({
        key: command,
        label: COMMAND_COPY[command].label,
        detail: COMMAND_COPY[command].detail,
        onSelect: () => {
          runner.run(command);
        },
      }))}
    />
  );
}
