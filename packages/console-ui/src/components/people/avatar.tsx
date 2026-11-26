import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type { ReactNode } from "react";
import { Chip } from "@shepherdjerred/console-ui/components/chip.tsx";

export type AvatarSize = 16 | 20 | 24;

export type AvatarProps = {
  /** The person or agent; also the initials when the image is missing. */
  readonly name: string;
  readonly src?: string | undefined;
  /** 16, 20 (default) or 24px. */
  readonly size?: AvatarSize;
  /** Hidden from assistive technology when the name is beside it. */
  readonly decorative?: boolean;
};

/** Up to two initials, from the first two words of a name. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._@-]+/)
    .filter((word) => word !== "");
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/**
 * A small rounded-square picture of a person or agent. Until the image
 * loads, or when it fails, the initials stand in on the track fill.
 */
export function Avatar({
  name,
  src,
  size = 20,
  decorative = false,
}: AvatarProps): React.JSX.Element {
  return (
    <AvatarPrimitive.Root
      className="ui-avatar"
      data-size={size}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": name, title: name })}
    >
      {src === undefined ? null : (
        <AvatarPrimitive.Image
          className="ui-avatar-image"
          src={src}
          alt=""
          width={size}
          height={size}
        />
      )}
      <AvatarPrimitive.Fallback className="ui-avatar-initials">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export type ActorChipProps = {
  readonly name: string;
  readonly src?: string | undefined;
  /** A muted word after the name, e.g. "agent". */
  readonly kind?: ReactNode;
  /** Makes the chip a link, e.g. to the actor's page. */
  readonly href?: string;
};

/** A person or agent in a chip: a 16px avatar, the name and an optional kind. */
export function ActorChip({
  name,
  src,
  kind,
  href,
}: ActorChipProps): React.JSX.Element {
  const content = (
    <>
      <Avatar name={name} src={src} size={16} decorative />
      <span className="ui-actor-name">{name}</span>
      {kind === undefined ? null : (
        <span className="ui-actor-kind">{kind}</span>
      )}
    </>
  );
  return href === undefined ? (
    <Chip>{content}</Chip>
  ) : (
    <Chip href={href}>{content}</Chip>
  );
}
