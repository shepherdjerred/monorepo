export function DiscordIdentity(props: {
  displayName: string;
  avatarUrl?: string;
  detail?: string;
}) {
  return (
    <span className="scout-discord-identity">
      {props.avatarUrl === undefined ? (
        <span
          className="scout-discord-identity__placeholder"
          aria-hidden="true"
        >
          {props.displayName.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          src={props.avatarUrl}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
        />
      )}
      <span>
        <strong>{props.displayName}</strong>
        {props.detail === undefined ? null : <small>{props.detail}</small>}
      </span>
    </span>
  );
}
