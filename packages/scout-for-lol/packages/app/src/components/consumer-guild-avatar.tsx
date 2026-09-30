type ConsumerGuildAvatarProps = {
  name: string;
  size: "compact" | "large";
  guildId?: string | null | undefined;
  icon?: string | null | undefined;
};

export function ConsumerGuildAvatar(props: ConsumerGuildAvatarProps) {
  const initial = props.name.trim().slice(0, 1).toLocaleUpperCase();
  const sizeClasses =
    props.size === "large"
      ? "h-12 w-12 rounded-lg text-lg"
      : "h-10 w-10 rounded-md text-base";

  if (
    typeof props.guildId === "string" &&
    typeof props.icon === "string" &&
    props.icon.length > 0
  ) {
    const dimension = props.size === "large" ? 48 : 40;
    return (
      <img
        alt=""
        aria-hidden="true"
        className={`shrink-0 object-cover ${sizeClasses}`}
        height={dimension}
        src={`https://cdn.discordapp.com/icons/${props.guildId}/${props.icon}.png?size=${props.size === "large" ? "128" : "64"}`}
        width={dimension}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-scout-hover font-semibold text-scout-subtle ${sizeClasses}`}
    >
      {initial}
    </div>
  );
}
