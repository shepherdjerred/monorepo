import {
  ActorChip,
  Avatar,
  Button,
  CommandPalette,
  CommandPaletteCommands,
  createCommandPaletteStore,
  createRecentCommands,
  createShortcutRegistry,
  ICONS,
  KeyHint,
  Section,
  Sheet,
  SheetClose,
  ShortcutSheet,
  toast,
  type PaletteCommand,
  type PaletteSections,
  type PaletteStep,
} from "@shepherdjerred/console-ui";
import {
  BellOffIcon,
  CircleCheckIcon,
  CircleIcon,
  KeyboardIcon,
  ListChecksIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";

type KitContext = { readonly navigate: (to: string) => void };

/** The step palette's own store: no ⌘K, so Hub's palette keeps it. */
const stepPalette = createCommandPaletteStore(null);
const recent = createRecentCommands({ key: "hub-kit-palette-recent" });

/** The gallery's shortcuts, active only while the gallery is on screen. */
const shortcuts = createShortcutRegistry({
  groups: ["General", "Navigation", "Gallery"],
});

const ALERTS = ["DiskPressure", "VeleroStale", "PodRestarts", "CertExpiry"];

function statusStep(
  status: string,
  setStatus: (next: string) => void,
): PaletteStep<KitContext> {
  const option = (
    value: string,
    label: string,
    icon: typeof CircleIcon,
  ): PaletteCommand<KitContext> => ({
    id: `status-${value}`,
    label,
    icon,
    checked: status === value,
    run: () => {
      setStatus(value);
      toast.notify(`Status set to ${label.toLowerCase()}`);
    },
  });
  return {
    title: "Set status",
    placeholder: "Change status to…",
    sections: [
      {
        heading: "Status",
        items: [
          option("firing", "Firing", CircleIcon),
          option("resolved", "Resolved", CircleCheckIcon),
          option("silenced", "Silenced", BellOffIcon),
        ],
      },
    ],
  };
}

/** A stand-in for a server search over alerts. */
async function searchAlerts(
  query: string,
  signal: AbortSignal,
): Promise<PaletteSections<KitContext>> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 300);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Superseded", "AbortError"));
    });
  });
  const term = query.trim().toLowerCase();
  const items = ALERTS.filter((name) => name.toLowerCase().includes(term)).map(
    (name): PaletteCommand<KitContext> => ({
      id: `alert-${name}`,
      label: name,
      detail: "alert",
      icon: CircleIcon,
      run: ({ navigate }) => {
        navigate("/kit/detail");
      },
    }),
  );
  return items.length === 0 ? [] : [{ heading: "Matching alerts", items }];
}

function KitPalette(): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState("firing");
  const step = statusStep(status, setStatus);
  return (
    <>
      <Button
        onClick={() => {
          stepPalette.setOpen(true);
        }}
      >
        <ListChecksIcon aria-hidden="true" />
        Step palette
      </Button>
      <CommandPalette store={stepPalette} label="Gallery commands">
        <CommandPaletteCommands
          store={stepPalette}
          label="Gallery commands"
          placeholder="Type a command or search alerts…"
          context={{
            navigate: (to: string) => {
              void navigate(to);
            },
          }}
          recent={recent}
          loadSections={searchAlerts}
          sections={[
            {
              heading: "go/ha",
              items: [
                {
                  id: "set-status",
                  label: "Set status…",
                  icon: CircleIcon,
                  step,
                },
                {
                  id: "copy-id",
                  label: "Copy ID",
                  icon: ICONS.copy,
                  hint: "Mod+.",
                  run: () => toast.notify("Copied go/ha"),
                },
              ],
            },
            {
              heading: "Pages",
              items: [
                {
                  id: "detail",
                  label: "Open the detail page",
                  detail: "/kit/detail",
                  icon: ICONS.external,
                  run: ({ navigate: go }) => {
                    go("/kit/detail");
                  },
                },
              ],
            },
          ]}
        />
      </CommandPalette>
    </>
  );
}

function KitSheets(): React.JSX.Element {
  return (
    <Section title="Sheets" headingLevel={3}>
      <div className="ui-toolbar">
        <Sheet
          title="go/ha"
          description="Peek at a link without leaving the list."
          trigger={<Button>Side panel</Button>}
          actions={
            <>
              <SheetClose render={<Button />}>Close</SheetClose>
              <SheetClose render={<Button variant="primary" />}>
                Open link
              </SheetClose>
            </>
          }
        >
          <p className="kit-sheet-line">
            Owner <ActorChip name="Jerred Shepherd" />
          </p>
          <p className="kit-sheet-line">
            Last edited by <ActorChip name="Claude" kind="agent" />
          </p>
        </Sheet>
        <Sheet
          title="More"
          side="bottom"
          trigger={<Button>More (phone)</Button>}
        >
          <ul className="ui-sheet-links">
            <li>
              <a href="#alerts">
                <UsersIcon aria-hidden="true" />
                Actors
              </a>
            </li>
            <li>
              <a href="#alerts">
                <SettingsIcon aria-hidden="true" />
                Settings
              </a>
            </li>
            <li>
              <button type="button" onClick={() => toast.notify("Opened help")}>
                <KeyboardIcon aria-hidden="true" />
                Keyboard shortcuts
              </button>
            </li>
          </ul>
        </Sheet>
      </div>
    </Section>
  );
}

function KitKeys(): React.JSX.Element {
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  // Registered while the section is mounted; React runs the returned cleanup.
  const bindShortcuts = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      const release = shortcuts.activateScope("kit");
      const unregister = shortcuts.register([
        {
          id: "help",
          keys: "?",
          description: "Keyboard shortcuts",
          group: "General",
          scope: "kit",
          run: () => {
            setHelp(true);
          },
        },
        {
          id: "undo",
          keys: "Mod+Z",
          description: "Undo the last change",
          group: "General",
          scope: "kit",
          run: () => toast.undoLatest(),
        },
        {
          id: "go-detail",
          keys: "g d",
          description: "Go to the detail page",
          group: "Navigation",
          scope: "kit",
          run: () => {
            void navigate("/kit/detail");
          },
        },
        {
          id: "notify",
          keys: "n",
          description: "Show a toast",
          group: "Gallery",
          scope: "kit",
          run: () => toast.notify("Pressed N"),
        },
      ]);
      return () => {
        unregister();
        release();
      };
    },
    [navigate],
  );
  return (
    <Section title="Keyboard" headingLevel={3}>
      <div className="ui-toolbar" ref={bindShortcuts}>
        <span className="kit-key">
          Search <KeyHint keys="Mod+K" />
        </span>
        <span className="kit-key">
          Detail page <KeyHint keys="g d" />
        </span>
        <span className="kit-key">
          Help <KeyHint keys="?" />
        </span>
        <Button
          aria-keyshortcuts="?"
          onClick={() => {
            setHelp(true);
          }}
        >
          <KeyboardIcon aria-hidden="true" />
          Keyboard shortcuts
        </Button>
        <KitPalette />
        <ShortcutSheet
          registry={shortcuts}
          open={help}
          onOpenChange={setHelp}
        />
      </div>
    </Section>
  );
}

function KitAvatars(): React.JSX.Element {
  return (
    <Section title="Avatars" headingLevel={3}>
      <div className="ui-toolbar">
        <Avatar name="Jerred Shepherd" size={16} />
        <Avatar name="Jerred Shepherd" />
        <Avatar name="Jerred Shepherd" size={24} />
        <span className="ui-chips">
          <ActorChip name="Jerred Shepherd" />
          <ActorChip name="Claude" kind="agent" />
          <ActorChip name="ci-driver" kind="agent" href="#alerts" />
        </span>
      </div>
    </Section>
  );
}

/** Sheets, avatars, the shortcut registry and the step palette. */
export function KitPeopleAndKeys(): React.JSX.Element {
  return (
    <>
      <div className="ui-columns">
        <KitSheets />
        <KitAvatars />
      </div>
      <KitKeys />
    </>
  );
}
