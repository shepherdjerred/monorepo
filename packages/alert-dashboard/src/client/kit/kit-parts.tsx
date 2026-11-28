import { NavTabs, type RenderLinkProps } from "@shepherdjerred/console-ui";
import { Link, useLocation } from "react-router";

/** The gallery's two pages, as route tabs. */
export function KitTabs(): React.JSX.Element {
  const { pathname } = useLocation();
  return (
    <NavTabs
      label="Gallery pages"
      items={[
        { href: "/kit", label: "List page", current: pathname === "/kit" },
        {
          href: "/kit/detail",
          label: "Detail page",
          current: pathname === "/kit/detail",
        },
      ]}
      renderLink={({ href, ...props }: RenderLinkProps) => (
        <Link to={href} {...props} />
      )}
    />
  );
}

export type KitAlert = {
  readonly name: string;
  readonly severity: "error" | "warning" | "info" | "unknown" | "ok";
  readonly status: string;
  readonly service: string;
  readonly labels: readonly string[];
  readonly budget: number;
  readonly firing: string;
  readonly count: number;
};

/** Realistic rows for the gallery tables; nothing here is live data. */
export const KIT_GROUPS: readonly {
  readonly name: string;
  readonly alerts: readonly KitAlert[];
}[] = [
  {
    name: "cluster",
    alerts: [
      {
        name: "KubePodCrashLooping",
        severity: "error",
        status: "Critical",
        service: "temporal-worker",
        labels: ["namespace=temporal", "pod=worker-7c9"],
        budget: 97,
        firing: "2h 14m",
        count: 41,
      },
      {
        name: "NodeDiskPressure",
        severity: "warning",
        status: "Warning",
        service: "talos-node-2",
        labels: ["node=torvalds"],
        budget: 72,
        firing: "38m",
        count: 3,
      },
      {
        name: "ArgoCDAppOutOfSync",
        severity: "info",
        status: "Info",
        service: "argocd",
        labels: ["app=homelab-root"],
        budget: 12,
        firing: "6m",
        count: 1,
      },
    ],
  },
  {
    name: "platform",
    alerts: [
      {
        name: "CertificateExpiringSoon",
        severity: "warning",
        status: "Warning",
        service: "cert-manager",
        labels: ["issuer=letsencrypt"],
        budget: 54,
        firing: "1d 3h",
        count: 2,
      },
      {
        name: "BackupStale",
        severity: "unknown",
        status: "No data",
        service: "velero",
        labels: ["schedule=nightly"],
        budget: 0,
        firing: "—",
        count: 0,
      },
    ],
  },
];
