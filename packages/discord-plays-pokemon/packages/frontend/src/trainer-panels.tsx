import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { PartyMon } from "@discord-plays-pokemon/common";
import type { Game } from "./game.ts";
import { pokemonSpriteUrl } from "./pokemon-sprites.ts";
import { firstGraphemes } from "@shepherdjerred/text";

const BADGES = [
  "Stone",
  "Knuckle",
  "Dynamo",
  "Heat",
  "Balance",
  "Feather",
  "Mind",
  "Rain",
];

export function Avatar({ user }: { readonly user: DiscordUser }) {
  return user.avatarUrl === null ? (
    <span className="avatar avatar-initial" aria-hidden="true">
      {firstGraphemes(user.name, 1).toUpperCase()}
    </span>
  ) : (
    <img
      className="avatar"
      src={user.avatarUrl}
      alt=""
      width={32}
      height={32}
      referrerPolicy="no-referrer"
    />
  );
}

function PartyCard({
  mon,
  slot,
}: {
  readonly mon: PartyMon | undefined;
  readonly slot: number;
}) {
  if (mon === undefined)
    return (
      <div className="party-card empty-slot">
        <span className="slot-number">0{slot}</span>
        <span>Empty slot</span>
      </div>
    );
  const fraction =
    mon.maxHp > 0 ? Math.max(0, Math.min(1, mon.hp / mon.maxHp)) : 0;
  const color =
    fraction > 0.5 ? "healthy" : fraction > 0.2 ? "hurt" : "critical";
  return (
    <div
      className={`party-card ${mon.hp === 0 && !mon.isEgg ? "fainted" : ""}`}
    >
      <span className="slot-number">0{slot}</span>
      <span className="party-sprite-frame">
        {mon.nationalDexNumber === null ? (
          <span className="egg-sprite" aria-hidden="true" />
        ) : (
          <img
            className="party-sprite"
            src={pokemonSpriteUrl(mon.nationalDexNumber)}
            alt=""
            width={64}
            height={64}
          />
        )}
      </span>
      <div className="party-details">
        <div className="party-name">
          <strong>{mon.nickname}</strong>
          <span>{mon.isEgg ? "EGG" : `Lv. ${String(mon.level)}`}</span>
        </div>
        <span className="species">
          {mon.species}
          {mon.hp === 0 && !mon.isEgg ? " · Fainted" : ""}
        </span>
        {!mon.isEgg && (
          <>
            <div className="hp-row">
              <span>HP</span>
              <div
                className="hp-track"
                role="meter"
                aria-label={`${mon.nickname} HP`}
                aria-valuemin={0}
                aria-valuemax={mon.maxHp}
                aria-valuenow={mon.hp}
              >
                <div
                  className={color}
                  style={{ width: `${String(fraction * 100)}%` }}
                />
              </div>
            </div>
            <span className="hp-value">
              {mon.hp} / {mon.maxHp}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function TrainerPanels({ game }: { readonly game: Game }) {
  const state = game.state;
  return (
    <>
      <section className="dialog party" aria-labelledby="party-heading">
        <div className="section-heading">
          <h2 id="party-heading">Your party</h2>
          <span>{state?.party.length ?? 0} / 6</span>
        </div>
        <div className="party-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <PartyCard key={index} mon={state?.party[index]} slot={index + 1} />
          ))}
        </div>
      </section>
      <section className="dialog badge-case" aria-labelledby="badge-heading">
        <div className="section-heading">
          <h2 id="badge-heading">Hoenn badge case</h2>
          <span>{state?.badges.filter(Boolean).length ?? 0} / 8</span>
        </div>
        <div className="badges">
          {BADGES.map((badge, index) => (
            <div
              key={badge}
              className={
                state?.badges[index] === true ? "badge earned" : "badge"
              }
              aria-label={`${badge} badge: ${state?.badges[index] === true ? "earned" : "not earned"}`}
            >
              <span aria-hidden="true">◆</span>
              <small>{badge}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="dialog trainer-strip" aria-label="Trainer progress">
        <div>
          <span>POKÉDEX</span>
          <strong>
            {state?.pokedexOwned ?? "—"} <small>caught</small>
          </strong>
        </div>
        <div>
          <span>POKÉDOLLARS</span>
          <strong>
            {state?.money === null || state?.money === undefined
              ? "—"
              : `₽ ${state.money.toLocaleString()}`}
          </strong>
        </div>
        <div>
          <span>ADVENTURE</span>
          <strong>
            {state === null
              ? "Waiting"
              : state.phase === "overworld"
                ? "Exploring"
                : state.phase}
          </strong>
        </div>
      </section>
      {state?.goal !== null && state?.goal !== undefined && (
        <section className="dialog goal">
          <div className="section-heading">
            <h2>Current goal</h2>
            <span>{state.goal.status}</span>
          </div>
          <p>{state.goal.goal}</p>
        </section>
      )}
    </>
  );
}

export function ActivityPanels({ game }: { readonly game: Game }) {
  return (
    <>
      <section className="dialog" aria-labelledby="players-heading">
        <div className="section-heading">
          <h2 id="players-heading">Playing together</h2>
          <span>{game.status?.playerList.length ?? 0}</span>
        </div>
        <p className="channel-name">
          {game.status?.voiceChannelName ?? "No active voice channel"}
        </p>
        <div className="players">
          {game.status?.playerList.map((user) => (
            <div className="player" key={user.discordId}>
              <Avatar user={user} />
              <span>{user.name}</span>
            </div>
          ))}
        </div>
        {game.status?.playerList.length === 0 && (
          <p className="empty-copy">Your adventure is better with friends.</p>
        )}
      </section>
      <section className="dialog activity" aria-labelledby="events-heading">
        <div className="section-heading">
          <h2 id="events-heading">Adventure journal</h2>
          <span>EVENTS</span>
        </div>
        {game.events.length === 0 ? (
          <p className="empty-copy">
            Catches, badges, and big moments will appear here.
          </p>
        ) : (
          <ol>
            {game.events.toReversed().map((event) => (
              <li key={event.id}>
                {event.pokemonArtwork.length === 0 ? (
                  <span className="event-marker" aria-hidden="true">
                    ◆
                  </span>
                ) : (
                  <span
                    className={`event-artwork ${event.event === "evolution" ? "evolution" : ""}`}
                    aria-hidden="true"
                  >
                    {event.pokemonArtwork.map((pokemon, index) => (
                      <span
                        className="event-sprite-wrap"
                        key={`${String(pokemon.nationalDexNumber)}:${String(index)}`}
                      >
                        {event.event === "evolution" && index > 0 && (
                          <span className="evolution-arrow">→</span>
                        )}
                        {pokemon.shiny && (
                          <span className="shiny-sparkle">✦</span>
                        )}
                        <img
                          className={`event-sprite ${pokemon.shiny ? "shiny" : ""}`}
                          src={pokemonSpriteUrl(
                            pokemon.nationalDexNumber,
                            pokemon.shiny,
                          )}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    ))}
                  </span>
                )}
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.text}</p>
                  <time dateTime={event.at}>
                    {new Date(event.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section
        className="dialog activity input-log"
        aria-labelledby="inputs-heading"
      >
        <div className="section-heading">
          <h2 id="inputs-heading">Recent inputs</h2>
          <span>SHARED CONTROLS</span>
        </div>
        {game.inputs.length === 0 ? (
          <p className="empty-copy">The next move is yours.</p>
        ) : (
          <ol>
            {game.inputs
              .toReversed()
              .slice(0, 12)
              .map((input) => (
                <li key={input.id}>
                  <div>
                    <strong>{input.user}</strong>
                    <small>{input.source}</small>
                  </div>
                  <code>{input.command}</code>
                </li>
              ))}
          </ol>
        )}
      </section>
    </>
  );
}
