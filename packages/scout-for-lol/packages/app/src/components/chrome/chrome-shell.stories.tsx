import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CompetitionStatus } from "@scout-for-lol/data";
import { PageSectionHeading } from "./page-section-heading.tsx";
import { DelayedLoadingState, SectionSkeleton } from "./section-skeleton.tsx";
import {
  CompetitionStatusBadge,
  ReportRunStatusBadge,
} from "./status-badge.tsx";
import { LoadMore } from "./load-more.tsx";
import { ContractMismatchBanner } from "./version-info.tsx";
import { ForbiddenPanel } from "./forbidden-panel.tsx";

/**
 * The small structural pieces every routed section is built from: its
 * heading, its loading placeholders, the badges its rows carry, its pagination
 * control, the owner-only build diagnostic, and the panel a refused route
 * shows.
 */
const meta = {
  title: "Chrome/Shell",
  component: PageSectionHeading,
  tags: ["autodocs"],
} satisfies Meta<typeof PageSectionHeading>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story callbacks: the catalog drives no navigation, mutation or stream.
}

const COMPETITION_STATUSES: readonly CompetitionStatus[] = [
  "ACTIVE",
  "DRAFT",
  "ENDED",
  "CANCELLED",
];

export const SectionHeading: Story = {
  args: {
    title: "Ranked Solo/Duo reports",
    description:
      "Weekly summaries posted to #scout-reports every Monday at 09:00 PT.",
  },
};

export const SectionHeadingLong: Story = {
  args: {
    title: "Hall of Fame",
    description:
      "Pentakills, 1v9 carries and 0/12 stat-checks from every tracked Summoner's Rift match this split.",
  },
};

export const Badges: Story = {
  args: { title: "unused", description: "unused" },
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {COMPETITION_STATUSES.map((status) => (
          <CompetitionStatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReportRunStatusBadge status="SUCCESS" />
        <ReportRunStatusBadge status="RUNNING" />
        <ReportRunStatusBadge status="FAILED" />
        <ReportRunStatusBadge status="QUEUED" />
        <ReportRunStatusBadge status={null} />
      </div>
    </div>
  ),
};

export const Pagination: Story = {
  args: { title: "unused", description: "unused" },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <LoadMore hasNextPage isFetchingNextPage={false} onLoadMore={noop} />
      <LoadMore hasNextPage isFetchingNextPage onLoadMore={noop} />
      <p className="text-sm text-scout-subtle">
        With no next page the button renders nothing at all.
      </p>
    </div>
  ),
};

export const LoadingPlaceholders: Story = {
  args: { title: "unused", description: "unused" },
  render: () => (
    <div className="space-y-4">
      <PageSectionHeading
        title="Players"
        description="Both placeholders are delayed, so a fast load never flashes them."
      />
      <SectionSkeleton />
      <DelayedLoadingState label="Loading tracked players…" />
    </div>
  ),
};

export const Forbidden: Story = {
  args: { title: "unused", description: "unused" },
  render: () => (
    <div className="space-y-4">
      <ForbiddenPanel />
      <ForbiddenPanel
        title="Audit log is restricted"
        message="Only members with the audit:read permission can read this server's audit log."
      />
    </div>
  ),
};

/**
 * The banner compares this bundle's contract hash with the backend's. Both
 * are the `dev` placeholder outside a site-release build, which deliberately
 * disables the check — so in the catalog it renders nothing, and this story
 * documents that rather than faking a release build.
 */
export const ContractMismatchInDevBuild: Story = {
  args: { title: "unused", description: "unused" },
  render: () => (
    <div className="space-y-2">
      <PageSectionHeading
        title="Contract mismatch banner"
        description="Owner-only corner chip, inert unless both sides report real contract hashes."
      />
      <ContractMismatchBanner />
    </div>
  ),
};
