import { EmptyState as ScoutEmptyState } from "@scout-for-lol/design-system/layout";
import { Cloud, Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function CloudIcon(props: ComponentProps<typeof Cloud>) {
  return <Cloud {...props} />;
}

export function SearchIcon(props: ComponentProps<typeof Search>) {
  return <Search {...props} />;
}

export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <ScoutEmptyState>
      {props.icon}
      <h3>{props.title}</h3>
      {props.description === undefined ? null : <p>{props.description}</p>}
      {props.action}
    </ScoutEmptyState>
  );
}
