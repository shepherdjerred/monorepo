import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.tsx";
import { Field, FieldDescription, FieldError } from "./field.tsx";

const meta = {
  title: "Components/Forms/Select",
  component: Select,
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

const regions = [
  { value: "na1", label: "North America (NA1)" },
  { value: "euw1", label: "Europe West (EUW1)" },
  { value: "kr", label: "Korea (KR)" },
  { value: "br1", label: "Brazil (BR1)" },
] as const;

function ControlledQueue() {
  const [queue, setQueue] = useState("solo");
  return (
    <div className="scout-stack" style={{ maxWidth: "20rem" }}>
      <Select value={queue} onValueChange={setQueue}>
        <SelectTrigger aria-label="Queue">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="solo">Ranked Solo/Duo</SelectItem>
          <SelectItem value="flex">Ranked Flex 5v5</SelectItem>
          <SelectItem value="aram">ARAM</SelectItem>
        </SelectContent>
      </Select>
      <p className="scout-muted">{`Reports will cover the ${queue} queue.`}</p>
    </div>
  );
}

function RegionSelect(props: { defaultValue?: string }) {
  const { defaultValue } = props;
  return (
    <div style={{ maxWidth: "20rem" }}>
      <Select {...(defaultValue === undefined ? {} : { defaultValue })}>
        <SelectTrigger aria-label="Riot region">
          <SelectValue placeholder="Choose a region" />
        </SelectTrigger>
        <SelectContent>
          {regions.map((region) => (
            <SelectItem key={region.value} value={region.value}>
              {region.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export const Default: Story = {
  args: {},
  render: () => <RegionSelect />,
};

export const WithDefaultValue: Story = {
  args: {},
  render: () => <RegionSelect defaultValue="kr" />,
};

export const Grouped: Story = {
  args: {},
  render: () => (
    <div style={{ maxWidth: "22rem" }}>
      <Select defaultValue="weekly-ranked">
        <SelectTrigger aria-label="Report template">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Recurring</SelectLabel>
            <SelectItem value="weekly-ranked">Weekly ranked recap</SelectItem>
            <SelectItem value="monthly-climb">Monthly climb report</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>On demand</SelectLabel>
            <SelectItem value="match-recap">Single match recap</SelectItem>
            <SelectItem value="custom-game">Custom game scoreboard</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const WithFieldAndError: Story = {
  args: {},
  render: () => (
    <div style={{ maxWidth: "22rem" }}>
      <Field>
        <Select>
          <SelectTrigger
            aria-label="Delivery channel"
            aria-invalid="true"
            aria-describedby="select-channel-error"
          >
            <SelectValue placeholder="Choose a channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ranked-reports">#ranked-reports</SelectItem>
            <SelectItem value="highlights">#highlights</SelectItem>
            <SelectItem value="bot-spam">#bot-spam</SelectItem>
          </SelectContent>
        </Select>
        <FieldError id="select-channel-error">
          Pick a channel Scout can post in.
        </FieldError>
      </Field>
    </div>
  ),
};

export const Disabled: Story = {
  args: {},
  render: () => (
    <div style={{ maxWidth: "22rem" }}>
      <Field>
        <Select disabled defaultValue="na1">
          <SelectTrigger
            aria-label="Riot region"
            aria-describedby="select-region-description"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {regions.map((region) => (
              <SelectItem key={region.value} value={region.value}>
                {region.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription id="select-region-description">
          Region is locked once matches have been ingested.
        </FieldDescription>
      </Field>
    </div>
  ),
};

export const Controlled: Story = {
  args: {},
  render: () => <ControlledQueue />,
};
