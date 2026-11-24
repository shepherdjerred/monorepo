import { AlertTriangle, RefreshCw } from "lucide-react";
import type {
  ActivityGroup,
  Platform,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  activityGroupLabel,
  activityGroupPillClass,
  buildAvatarDescriptor,
  formatDecimal,
  formatPlatform,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { playerProfilePath } from "@shepherdjerred/storm-stats/client/router.ts";
import type { ApiQueryState } from "@shepherdjerred/storm-stats/client/api.ts";
import { SpaLink } from "./spa-link.tsx";

export function StormLogoMark({ size = 34 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
    >
      <rect width="64" height="64" rx="14" fill="#132229" />
      <path
        d="M47.5 23.5a10.5 10.5 0 0 0-8.8-8.2A13.5 13.5 0 0 0 13 21.5c0 .7.05 1.4.16 2.08A9.5 9.5 0 0 0 17.5 41.5h29a9 9 0 0 0 1-18Z"
        fill="#ecf4f6"
      />
      <polygon
        points="35,14 21,34 30,34 25,51 43,29 33.5,29"
        fill="#00d0c6"
        stroke="#0d181d"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayerAvatar({
  seed,
  large = false,
}: {
  readonly seed: string;
  readonly large?: boolean;
}) {
  const descriptor = buildAvatarDescriptor(seed);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className={large ? "mc-avatar mc-avatar-lg" : "mc-avatar"}
    >
      <rect x="0" y="0" width="8" height="8" fill={descriptor.bg} />
      <rect x="1" y="0" width="6" height="2" fill={descriptor.primary} />
      {descriptor.activePixels.map(([x, y]) => (
        <rect
          key={`${String(x)}-${String(y)}`}
          x={x}
          y={y}
          width="1"
          height="1"
          fill={y <= 2 ? descriptor.highlight : descriptor.primary}
        />
      ))}
      <rect x="2" y="3" width="1" height="1" fill="#ffffff" />
      <rect x="5" y="3" width="1" height="1" fill="#ffffff" />
    </svg>
  );
}

function distinctNickname(
  nickname: string | null | undefined,
  name: string,
): string | null {
  if (nickname === null || nickname === undefined || nickname === name) {
    return null;
  }
  return nickname.length > 0 ? nickname : null;
}

export function PlayerIdentityLink({
  uuid,
  name,
  nickname,
  online,
}: {
  readonly uuid?: string | null | undefined;
  readonly name: string;
  readonly nickname?: string | null | undefined;
  readonly online?: boolean | undefined;
}) {
  const seed = uuid ?? name;
  const shownNickname = distinctNickname(nickname, name);
  return (
    <SpaLink href={playerProfilePath(name)} className="player-chip">
      <PlayerAvatar seed={seed} />
      <span>
        <span>{name}</span>
        {shownNickname === null ? null : (
          <span className="panel-subtitle"> ({shownNickname})</span>
        )}
      </span>
      {online === true ? (
        <span className="pill pill-regular">Online</span>
      ) : null}
    </SpaLink>
  );
}

export function PlayerRowHeader({
  uuid,
  name,
}: {
  readonly uuid?: string | null | undefined;
  readonly name: string;
}) {
  return (
    <th scope="row">
      <PlayerIdentityLink uuid={uuid} name={name} />
    </th>
  );
}

export function ActivityGroupBadge({
  group,
  index,
}: {
  readonly group: ActivityGroup;
  readonly index?: number | undefined;
}) {
  return (
    <span className={activityGroupPillClass(group)}>
      <span>{activityGroupLabel(group)}</span>
      {index === undefined ? null : (
        <span className="mono">· {formatDecimal(index, 2)}</span>
      )}
    </span>
  );
}

export function PlatformBadge({
  platform,
  version,
}: {
  readonly platform: Platform;
  readonly version?: string | undefined;
}) {
  return (
    <span
      className={platform === "java" ? "pill pill-neutral" : "pill pill-active"}
    >
      {formatPlatform(platform, version)}
    </span>
  );
}

export function QueryFailurePanel({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div role="alert" className="status-box status-box-error">
      <div className="live-pill">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>Unable to load analytics data</span>
      </div>
      <p style={{ margin: 0 }}>{message}</p>
      <button type="button" className="btn" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" />
        <span>Retry request</span>
      </button>
    </div>
  );
}

export function QueryPendingPanel({ label }: { readonly label: string }) {
  return (
    <div className="status-box">
      <span className="panel-subtitle">{label}</span>
      <progress aria-label={label} style={{ inlineSize: "100%" }} />
    </div>
  );
}

export function renderQueryGate<T>(
  query: {
    readonly state: ApiQueryState<T>;
    readonly refetch: () => void;
  },
  loadingLabel: string,
  renderSuccess: (data: T) => React.ReactNode,
): React.ReactNode {
  switch (query.state.status) {
    case "idle":
    case "pending":
      return <QueryPendingPanel label={loadingLabel} />;
    case "error":
      return (
        <QueryFailurePanel
          message={query.state.error}
          onRetry={query.refetch}
        />
      );
    case "success":
      return renderSuccess(query.state.data);
  }
}
