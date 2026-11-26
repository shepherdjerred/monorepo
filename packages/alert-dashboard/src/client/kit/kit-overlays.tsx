import {
  Button,
  Combobox,
  ContextMenu,
  ICONS,
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Popover,
  PopoverClose,
  Section,
  Select,
  Submenu,
  toast,
  ToastProvider,
  type PickerOption,
  type PickerOptions,
} from "@shepherdjerred/console-ui";
import {
  ArchiveIcon,
  BellOffIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  FolderIcon,
  LinkIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";

import { KitPeopleAndKeys } from "./kit-overlays-more.tsx";

const STATUSES: PickerOptions = [
  { value: "firing", label: "Firing", icon: CircleIcon },
  { value: "pending", label: "Pending", icon: CircleDashedIcon },
  {
    label: "Done",
    options: [
      {
        value: "resolved",
        label: "Resolved",
        icon: CircleCheckIcon,
        description: "Cleared by the source",
      },
      {
        value: "silenced",
        label: "Silenced",
        icon: BellOffIcon,
        description: "Muted until the silence ends",
      },
    ],
  },
];

const OWNERS: PickerOptions = [
  {
    label: "People",
    options: [
      { value: "jerred", label: "Jerred Shepherd" },
      { value: "sam", label: "Sam Rivera" },
    ],
  },
  {
    label: "Agents",
    options: [
      { value: "claude", label: "Claude", description: "agent" },
      { value: "ci-driver", label: "ci-driver", description: "agent" },
    ],
  },
];

const SERVICES = [
  "alertmanager",
  "argocd",
  "grafana",
  "loki",
  "postgres",
  "temporal-worker",
  "tempo",
  "velero",
];

/** A stand-in for a server search: 400ms, aborted when a newer query wins. */
async function searchServices(
  query: string,
  signal: AbortSignal,
): Promise<PickerOptions> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Superseded", "AbortError"));
    });
  });
  const term = query.trim().toLowerCase();
  return term === ""
    ? []
    : SERVICES.filter((name) => name.includes(term)).map((name) => ({
        value: name,
        label: name,
        icon: FolderIcon,
      }));
}

function KitMenus(): React.JSX.Element {
  const [showResolved, setShowResolved] = useState(true);
  const [sort, setSort] = useState("severity");
  const Copy = ICONS.copy;
  const Delete = ICONS.delete;
  const menu = (
    <>
      <MenuGroup>
        <MenuItem
          icon={Copy}
          shortcut="Mod+."
          onSelect={() => toast.notify("Copied go/ha")}
        >
          Copy ID
        </MenuItem>
        <MenuItem icon={LinkIcon} onSelect={() => toast.notify("Copied link")}>
          Copy link
        </MenuItem>
        <Submenu icon={FolderIcon} label="Move to">
          <MenuItem onSelect={() => toast.notify("Moved to Cluster")}>
            Cluster
          </MenuItem>
          <MenuItem onSelect={() => toast.notify("Moved to Storage")}>
            Storage
          </MenuItem>
        </Submenu>
      </MenuGroup>
      <MenuSeparator />
      <MenuCheckboxItem
        checked={showResolved}
        onCheckedChange={setShowResolved}
      >
        Show resolved
      </MenuCheckboxItem>
      <MenuRadioGroup label="Sort by" value={sort} onValueChange={setSort}>
        <MenuRadioItem value="severity">Severity</MenuRadioItem>
        <MenuRadioItem value="age">Age</MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem
        icon={ArchiveIcon}
        description="Hidden from the list, kept for 30 days"
        onSelect={() =>
          toast.undo("Archived go/ha", {
            undo: () => toast.notify("Restored go/ha"),
          })
        }
      >
        Archive
      </MenuItem>
      <MenuItem icon={Delete} danger disabled>
        Delete…
      </MenuItem>
    </>
  );
  return (
    <Section title="Menus" headingLevel={3}>
      <div className="ui-toolbar">
        <Menu trigger={<Button>Actions</Button>} label="Actions for go/ha">
          {menu}
        </Menu>
        <ContextMenu label="Actions for go/ha" menu={menu}>
          <span className="kit-target" tabIndex={0}>
            go/ha: right-click, long press or Shift+F10
          </span>
        </ContextMenu>
      </div>
    </Section>
  );
}

function KitPopover(): React.JSX.Element {
  const [grouping, setGrouping] = useState("pending");
  return (
    <Section title="Popover" headingLevel={3}>
      <div className="ui-toolbar">
        <Popover
          title="Display"
          trigger={
            <Button>
              <SlidersHorizontalIcon aria-hidden="true" />
              Display
            </Button>
          }
        >
          <label className="kit-row">
            <span>Show status</span>
            <Select
              label="Show status"
              value={grouping}
              onValueChange={setGrouping}
              options={STATUSES}
            />
          </label>
          <div className="ui-toolbar-end">
            <PopoverClose render={<Button variant="primary" />}>
              Done
            </PopoverClose>
          </div>
        </Popover>
      </div>
    </Section>
  );
}

function KitPickers(): React.JSX.Element {
  const [status, setStatus] = useState("firing");
  const [owner, setOwner] = useState<string | null>("claude");
  const [labels, setLabels] = useState<string[]>(["prod", "paging"]);
  const [labelOptions, setLabelOptions] = useState<PickerOption[]>([
    { value: "prod", label: "prod" },
    { value: "paging", label: "paging" },
    { value: "storage", label: "storage" },
    { value: "network", label: "network" },
  ]);
  const [service, setService] = useState<string | null>(null);
  return (
    <Section title="Select and combobox" headingLevel={3}>
      <div className="ui-section-body kit-pickers">
        <label className="kit-row">
          <span>Status</span>
          <Select
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={STATUSES}
          />
        </label>
        <div className="kit-row">
          <span>Owner</span>
          <Combobox
            label="Owner"
            value={owner}
            onValueChange={setOwner}
            options={OWNERS}
          />
        </div>
        <div className="kit-row">
          <span>Service</span>
          <Combobox
            label="Service"
            placeholder="Search services…"
            value={service}
            onValueChange={setService}
            loadOptions={searchServices}
          />
        </div>
        <div className="kit-row">
          <span>Labels</span>
          <Combobox
            multiple
            label="Labels"
            value={labels}
            onValueChange={setLabels}
            options={labelOptions}
            onCreate={(query) => {
              const created = { value: query, label: query };
              setLabelOptions((known) => [...known, created]);
              return created;
            }}
          />
        </div>
      </div>
    </Section>
  );
}

function KitToasts(): React.JSX.Element {
  return (
    <Section title="Toasts" headingLevel={3}>
      <div className="ui-toolbar">
        <Button
          onClick={() =>
            toast.notify("Silence created for velero", {
              action: { label: "Open", run: () => toast.notify("Opened") },
            })
          }
        >
          Notify
        </Button>
        <Button
          onClick={() =>
            toast.error("Could not reach Alertmanager", {
              description: "connection refused",
            })
          }
        >
          Error
        </Button>
        <Button
          onClick={() =>
            toast.undo("Acknowledged 4 alerts", {
              undo: () => toast.notify("Acknowledgement undone"),
            })
          }
        >
          Undo
        </Button>
        <span className="ui-toolbar-end ui-muted">F6 moves focus to them</span>
      </div>
    </Section>
  );
}

/**
 * The gallery's overlays and inputs: every CU4 piece, live. Toasts render
 * in this page's own region, which is Hub's only one for now.
 */
export function KitOverlays(): React.JSX.Element {
  return (
    <ToastProvider>
      <Section title="Overlays and inputs">
        <p className="ui-section-body ui-muted">
          Menus, popovers, pickers, toasts, sheets and keyboard shortcuts. Every
          piece below is live; press ? for the shortcuts.
        </p>
      </Section>
      <div className="ui-columns">
        <KitMenus />
        <KitPopover />
      </div>
      <div className="ui-columns">
        <KitPickers />
        <KitToasts />
      </div>
      <KitPeopleAndKeys />
    </ToastProvider>
  );
}
