import { useState } from "react";
import type { SportsArtwork as Matchup } from "@shepherdjerred/streambot/sports/artwork.ts";

function Logo({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  const words = name.split(/\s+/u);
  const monogram =
    words.length === 1
      ? name.slice(0, 3)
      : words
          .map((part) => part[0])
          .join("")
          .slice(0, 3);
  return url === undefined || failed ? (
    <span className="team-monogram" title={name}>
      {monogram}
    </span>
  ) : (
    <img
      src={url}
      alt={name}
      title={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

export function SportsArtwork({
  artwork,
  className = "",
}: {
  artwork?: Matchup;
  className?: string;
}) {
  return (
    <div className={"sports-artwork " + className}>
      <div className="matchup-logos">
        {artwork !== undefined && artwork.teams.length > 0 ? (
          artwork.teams.map((team) => (
            <Logo
              key={team.logoUrl ?? team.name}
              name={team.name}
              {...(team.logoUrl === undefined ? {} : { url: team.logoUrl })}
            />
          ))
        ) : (
          <span aria-label="Live sports">◉</span>
        )}
      </div>
      {artwork?.league !== undefined && (
        <span className="league-mark" title={artwork.league.name}>
          <Logo
            key={artwork.league.logoUrl ?? artwork.league.name}
            name={artwork.league.name}
            {...(artwork.league.logoUrl === undefined
              ? {}
              : { url: artwork.league.logoUrl })}
          />
        </span>
      )}
    </div>
  );
}
