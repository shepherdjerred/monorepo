import type { PokemonState } from "@arcade/common/telemetry.ts";
import type { GamePageProps } from "./module.ts";
import { Activity, Metric, Panel } from "#src/ui/panels.tsx";

export function EmeraldPage({ room, stats }: GamePageProps) {
  const state =
    room.state?.family === "pokemon" ? room.state : (stats?.progress ?? null);
  return (
    <div className="game-panels emerald-layout">
      <Panel
        title={
          room.session === null ? "Our saved adventure" : "Our Hoenn adventure"
        }
        aside={
          <span className="tag">
            {state?.location ?? "A new journey awaits"}
          </span>
        }
      >
        <div className="metrics">
          <Metric label="Pokédex" value={state?.pokedexOwned ?? "—"} />
          <Metric label="Trainer money" value={trainerMoney(state)} />
          <Metric
            label="Badges"
            value={state?.badges.filter(Boolean).length ?? "—"}
          />
        </div>
        <div className="badge-case" aria-label="Hoenn badges">
          {Array.from({ length: 8 }, (_unused, index) => (
            <span
              className={`badge-emblem ${state?.badges[index] === true ? "earned" : ""}`}
              key={index}
              aria-label={`Badge ${String(index + 1)}${state?.badges[index] === true ? " earned" : " not earned"}`}
            >
              {index + 1}
            </span>
          ))}
        </div>
      </Panel>
      <PartyPanel state={state} />
      <Panel title="The next chapter">
        <p className="goal-text">
          {state?.goal?.goal ??
            "Explore together, catch a new companion, or take on the next gym."}
        </p>
        {state?.goal && <span className="tag">{state.goal.status}</span>}
      </Panel>
      <Activity events={room.events} />
      {room.participants.length > 0 && (
        <Panel title="Playing together">
          <div className="voice-roster">
            {room.participants.map((player) => (
              <span key={player.discordId}>{player.name}</span>
            ))}
          </div>
        </Panel>
      )}
      <AdventureJournal stats={stats} />
    </div>
  );
}

function PartyPanel({ state }: { readonly state: PokemonState | null }) {
  return (
    <Panel
      title="The party"
      aside={<span>{state?.party.length ?? 0} / 6</span>}
    >
      <div className="party">
        {state !== null && state.party.length > 0 ? (
          state.party.map((pokemon, index) => (
            <div className="party-member" key={index}>
              <span className="party-symbol" aria-hidden="true">
                {pokemon.isEgg ? "◉" : "✦"}
              </span>
              <div>
                <h3>{pokemon.nickname || pokemon.species}</h3>
                <p>
                  {pokemon.species} · Lv. {pokemon.level}
                </p>
                <progress
                  value={pokemon.hp}
                  max={Math.max(1, pokemon.maxHp)}
                  aria-label={`${pokemon.nickname} HP`}
                />
                <span className="mono">
                  {pokemon.hp} / {pokemon.maxHp} HP
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="empty">Your companions will appear here.</p>
        )}
      </div>
    </Panel>
  );
}
function AdventureJournal({ stats }: Pick<GamePageProps, "stats">) {
  return (
    <Panel title="Adventure journal">
      {stats !== undefined && stats.milestones.length > 0 ? (
        <ol className="journal">
          {stats.milestones.map((event) => (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <p>{event.text}</p>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleDateString()}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">
          Catches, badges, evolutions, and other milestones will be remembered
          here.
        </p>
      )}
    </Panel>
  );
}

function trainerMoney(state: PokemonState | null) {
  const money = state?.money ?? null;
  return money === null ? "—" : `₽${money.toLocaleString()}`;
}
