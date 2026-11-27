import {
  Button,
  ButtonLink,
  Chip,
  Dialog,
  DialogClose,
  Field,
  ICONS,
  IconButton,
  Meter,
  Section,
  SEVERITIES,
  StatusGlyph,
} from "@shepherdjerred/console-ui";
import { ClockIcon, LoaderCircleIcon } from "lucide-react";

const ICON_ENTRIES = Object.entries(ICONS);

function DeleteDialog(): React.JSX.Element {
  const Delete = ICONS.delete;
  return (
    <Dialog
      size="sm"
      title="Delete go/ha?"
      description="The link stops resolving at once. Its click history is kept."
      trigger={
        <Button variant="danger">
          <Delete aria-hidden="true" />
          Delete link…
        </Button>
      }
      actions={
        <>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="danger" />}>Delete</DialogClose>
        </>
      }
    >
      <Field label="Reason" hint="Shown in the audit log.">
        {(control) => <input {...control} defaultValue="Moved to go/home" />}
      </Field>
    </Dialog>
  );
}

/** The controls and small pieces, each in its own section of the gallery. */
export function KitControls(): React.JSX.Element {
  const External = ICONS.external;
  const Copy = ICONS.copy;
  return (
    <>
      <div className="ui-columns">
        <Section title="Buttons" headingLevel={3}>
          <div className="ui-toolbar">
            <Button>Default</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <ButtonLink href="#alerts">
              <External aria-hidden="true" />
              Link
            </ButtonLink>
            <IconButton icon={Copy} label="Copy link" />
            <DeleteDialog />
          </div>
        </Section>
        <Section title="Chips" headingLevel={3}>
          <div className="ui-toolbar">
            <span className="ui-chips">
              <Chip>Manual</Chip>
              <Chip severity="warning">Read-only</Chip>
              <Chip label="Open" value={12} />
              <Chip
                label="Projected month"
                value="$118.20"
                severity="warning"
              />
              <Chip label="Failed" value={3} severity="error" href="#alerts" />
            </span>
          </div>
        </Section>
      </div>
      <div className="ui-columns">
        <Section title="Status" headingLevel={3}>
          <div className="ui-toolbar">
            {SEVERITIES.map((severity) => (
              <StatusGlyph key={severity} severity={severity} />
            ))}
            <StatusGlyph
              severity="info"
              icon={LoaderCircleIcon}
              label="Running"
            />
            <StatusGlyph severity="unknown" icon={ClockIcon} label="Queued" />
          </div>
        </Section>
        <Section title="Meters" headingLevel={3}>
          <div className="ui-toolbar">
            <Meter value={34} severity="ok" label="Disk used" />
            <Meter value={81} severity="warning" label="Memory used" />
            <Meter value={118} severity="error" label="API spend" />
            <Meter
              value={5}
              max={13}
              severity="info"
              label="Checks passed"
              text="5/13"
            />
          </div>
        </Section>
      </div>
      <div className="ui-columns">
        <Section title="Fields" headingLevel={3}>
          <div className="ui-section-body kit-fields">
            <Field label="Short name" hint="Letters, digits and dashes.">
              {(control) => <input {...control} defaultValue="grafana" />}
            </Field>
            <Field label="Destination" error="Enter a full https:// URL.">
              {(control) => <input {...control} defaultValue="grafana.local" />}
            </Field>
            <Field label="Owner" layout="inline">
              {(control) => <input {...control} defaultValue="jerred" />}
            </Field>
          </div>
        </Section>
        <Section title="Icons" count={ICON_ENTRIES.length} headingLevel={3}>
          <ul className="ui-section-body kit-icons">
            {ICON_ENTRIES.map(([name, icon]) => {
              const Icon = icon;
              return (
                <li key={name}>
                  <Icon aria-hidden="true" />
                  <span className="ui-mono">{name}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </>
  );
}
