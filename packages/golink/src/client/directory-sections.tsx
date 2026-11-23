import {
  CommandIcon,
  CornerDownRightIcon,
  GlobeIcon,
  ListIcon,
  NetworkIcon,
  PencilIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  DynamicLinkKind,
  LinkKind,
  ShortcutSpec,
} from "#shared/contract.ts";

export type KindFilter = "all" | "manual" | "ingress" | "site" | "alias";

export type KindCounts = {
  all: number;
  manual: number;
  ingress: number;
  site: number;
  alias: number;
};

export const KIND_FILTER_OPTIONS: readonly {
  value: KindFilter;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "all", label: "All", icon: ListIcon },
  { value: "manual", label: "Manual", icon: PencilIcon },
  { value: "ingress", label: "Tailnet", icon: NetworkIcon },
  { value: "site", label: "Public sites", icon: GlobeIcon },
  { value: "alias", label: "Auto-aliases", icon: CornerDownRightIcon },
];

export function sourceIcon(kind: LinkKind): LucideIcon {
  switch (kind) {
    case "manual": {
      return PencilIcon;
    }
    case "ingress": {
      return NetworkIcon;
    }
    case "site": {
      return GlobeIcon;
    }
    case "alias": {
      return CornerDownRightIcon;
    }
    case "shortcut": {
      return CommandIcon;
    }
  }
}

export function describeDynamicKind(kind: DynamicLinkKind): string {
  switch (kind) {
    case "ingress": {
      return "Tailnet Ingress";
    }
    case "site": {
      return "Platform Site";
    }
    case "alias": {
      return "Auto-Alias";
    }
    case "shortcut": {
      return "Shortcut";
    }
  }
}

export function describeLinkKind(kind: LinkKind): string {
  return kind === "manual" ? "Manual" : describeDynamicKind(kind);
}

export function ShortcutsSection({
  shortcuts,
}: {
  shortcuts: readonly ShortcutSpec[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <section id="shortcuts" aria-labelledby="shortcuts-heading">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="shortcuts-heading">
          Shortcuts
        </h2>
        <span className="ui-muted">Path templates resolved on the fly</span>
      </div>
      <div className="ui-table-scroll">
        <table className="ui-table golink-shortcuts">
          <thead>
            <tr>
              <th scope="col">Pattern</th>
              <th scope="col">Description</th>
              <th scope="col">Example</th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((spec) => (
              <tr key={spec.pattern}>
                <th scope="row" className="ui-mono">
                  go/{spec.pattern}
                </th>
                <td>{spec.description}</td>
                <td>
                  <a href={`/${spec.exampleShort}`} className="ui-mono">
                    go/{spec.exampleShort}
                  </a>
                  <span className="ui-muted ui-mono">
                    {" "}
                    → {spec.exampleTargetUrl}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
