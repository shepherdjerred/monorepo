import { cn } from "#src/lib/cn.ts";

type DiscordName = { username: string; displayName: string } | null | undefined;

/**
 * Render a Discord user by display name, falling back to the raw snowflake
 * when it hasn't been resolved. The raw ID is always available on hover.
 */
export function DiscordUser(props: {
  id: string | null;
  name?: DiscordName;
  className?: string;
}) {
  if (props.id === null) {
    return (
      <span className={cn("text-muted-foreground", props.className)}>—</span>
    );
  }
  if (props.name !== null && props.name !== undefined) {
    return (
      <span
        className={cn("text-sm", props.className)}
        title={`@${props.name.username} · ${props.id}`}
      >
        {props.name.displayName}
      </span>
    );
  }
  return (
    <span
      className={cn("font-mono text-xs text-muted-foreground", props.className)}
      title={props.id}
    >
      {props.id}
    </span>
  );
}
