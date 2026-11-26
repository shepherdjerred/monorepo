import { Tag } from "@shepherdjerred/console-ui";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useEffect, useRef } from "react";
import "./experiments.css";

import type {
  ExperimentLink,
  ExperimentPlan,
  ExperimentSummary,
} from "@shepherdjerred/experiments/contract";

export const EXPERIMENTS_PATH = "/experiments";
export const NEW_EXPERIMENT_PATH = "/experiments/new";

export const PLAN_FIELDS = [
  { name: "change", label: "Proposed change" },
  { name: "hypothesis", label: "Hypothesis" },
  { name: "scope", label: "Affected scope" },
  { name: "successCriteria", label: "Success criteria" },
  { name: "measurementMethod", label: "Measurement method" },
  { name: "baseline", label: "Baseline notes (optional)" },
  { name: "guardrails", label: "Guardrails (optional)" },
] as const satisfies readonly { name: keyof ExperimentPlan; label: string }[];

export const DECISIONS = {
  keep: "Keep",
  revert: "Revert",
  inconclusive: "Inconclusive",
  extend: "Extend",
} as const;

export function experimentPath(id: string): string {
  return `${EXPERIMENTS_PATH}/${encodeURIComponent(id)}`;
}

export function ExperimentStatus({
  item,
}: {
  readonly item: ExperimentSummary;
}) {
  if (item.isDue) return <Tag className="experiments-due">Review due</Tag>;
  if (item.decision !== null) return <Tag>{DECISIONS[item.decision]}</Tag>;
  return <Tag>{item.status === "draft" ? "Draft" : "Running"}</Tag>;
}

const calendarDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const pacificDateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});

export function ReviewDate({ date }: { readonly date: string | null }) {
  if (date === null) return "—";
  return (
    <time dateTime={date}>
      {calendarDate.format(new Date(`${date}T00:00:00Z`))}
    </time>
  );
}

export function ExperimentTime({ date }: { readonly date: string }) {
  return (
    <time dateTime={date}>{pacificDateTime.format(new Date(date))} PT</time>
  );
}

export function LinkedReference({ link }: { readonly link: ExperimentLink }) {
  switch (link.kind) {
    case "tracker":
      return (
        <a
          href={`${APP_HOSTS.tracker}/issues/${encodeURIComponent(link.issue)}`}
        >
          {link.issue}
        </a>
      );
    case "flag":
      return (
        <a
          href={`${APP_HOSTS.flags}/${link.deployment
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/")}/${encodeURIComponent(link.key)}`}
        >
          {link.deployment} / {link.key}
        </a>
      );
    case "url":
      return <a href={link.url}>{link.label}</a>;
  }
}

export function FormError({ error }: { readonly error: Error | null }) {
  const focusTarget = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error !== null) focusTarget.current?.focus();
  }, [error]);
  if (error === null) return null;
  return (
    <p
      ref={focusTarget}
      role="alert"
      tabIndex={-1}
      className="experiments-error"
    >
      {error.message}
    </p>
  );
}
