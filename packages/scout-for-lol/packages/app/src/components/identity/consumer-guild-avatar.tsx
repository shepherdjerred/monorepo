type ConsumerGuildAvatarProps = {
  name: string;
  size: "compact" | "large";
};

export function ConsumerGuildAvatar(props: ConsumerGuildAvatarProps) {
  const initial = props.name.trim().slice(0, 1).toLocaleUpperCase();
  const sizeClasses =
    props.size === "large"
      ? "h-12 w-12 rounded-lg text-lg"
      : "h-10 w-10 rounded-md text-base";

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-scout-hover font-semibold text-scout-subtle ${sizeClasses}`}
    >
      {initial}
    </div>
  );
}
