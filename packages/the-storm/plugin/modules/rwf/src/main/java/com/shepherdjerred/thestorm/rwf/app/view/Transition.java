package com.shepherdjerred.thestorm.rwf.app.view;

import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * One accepted match transition as other modules read it: the event and the effects that matter to
 * them, flattened to plain values, and the match afterwards.
 *
 * @param change what happened
 * @param effects the effects on combatants that other modules act on, in order
 * @param after the match afterwards
 */
public record Transition(Change change, List<Effect> effects, MatchState after) {

  public Transition {
    effects = List.copyOf(effects);
  }

  /** The event the match accepted. */
  public sealed interface Change {

    /** A combatant joined the lobby. */
    record Joined(UUID uuid, String name) implements Change {}

    /** A combatant left or disconnected. */
    record Left(UUID uuid) implements Change {}

    /** A combatant picked a kit. */
    record KitPicked(UUID uuid, String kitId) implements Change {}

    /**
     * The chosen map is loaded and ready to preview and play.
     *
     * @param mapId the map
     * @param blocksSha256 the hex SHA-256 of the map's blocks, which names its exact terrain
     */
    record MapReady(String mapId, String blocksSha256) implements Change {}

    /** The chosen map could not be loaded. */
    record MapFailed(String mapId) implements Change {}

    /** The lobby's map vote opened on these maps. */
    record BallotOpened(List<String> mapIds) implements Change {

      public BallotOpened {
        mapIds = List.copyOf(mapIds);
      }
    }

    /** A member voted for a map. */
    record Voted(UUID uuid, String mapId) implements Change {}

    /** A combatant was hurt in a live match. */
    record Damaged(UUID victim, Optional<UUID> attacker) implements Change {}

    /** An operator set the map, skipped or extended a phase, or placed a member on a team. */
    record Operated() implements Change {}

    /** Time passed. */
    record Ticked() implements Change {}

    /** An admin started the match now. */
    record ForceStarted() implements Change {}

    /** The match was stopped. */
    record Stopped() implements Change {}

    /** A combatant died. */
    record Died(UUID victim, Optional<UUID> killer) implements Change {}

    /** A combatant clicked a bomb with the fuse. */
    record BombClicked(UUID uuid, String bombId) implements Change {}

    /** The map was reset. */
    record Reset() implements Change {}

    /** A combatant looked around, so they are not AFK. */
    record LookedAround(UUID uuid) implements Change {}
  }

  /** An effect on a combatant another module acts on. */
  public sealed interface Effect {

    /** The combatant was moved. */
    record Teleported(UUID uuid, double x, double y, double z) implements Effect {}

    /** The combatant was given a kit. */
    record Equipped(UUID uuid, String kitId) implements Effect {}

    /** The combatant is out of the match and restored. */
    record Restored(UUID uuid) implements Effect {}

    /** The combatant now watches from the spectator point. */
    record Spectating(UUID uuid) implements Effect {}

    /** The rules counted a stat, such as {@code Armed} or {@code Defused}. */
    record StatRecorded(UUID uuid, String stat) implements Effect {}

    /** The combatant stands still at their spawn until the match goes live. */
    record Frozen(UUID uuid) implements Effect {}

    /** The combatant may move again. */
    record Unfrozen(UUID uuid) implements Effect {}

    /** The rules killed these combatants outright. */
    record Killed(List<UUID> victims) implements Effect {

      public Killed {
        victims = List.copyOf(victims);
      }
    }
  }

  public static Transition of(MatchNotification notification) {
    var effects = new ArrayList<Effect>();
    for (var effect : notification.effects()) {
      switch (effect) {
        case MatchEffect.Freeze freeze ->
            freeze.ids().forEach(id -> effects.add(new Effect.Frozen(id.uuid())));
        case MatchEffect.Unfreeze unfreeze ->
            unfreeze.ids().forEach(id -> effects.add(new Effect.Unfrozen(id.uuid())));
        default -> effect(effect).ifPresent(effects::add);
      }
    }
    return new Transition(
        change(notification.event()), effects, MatchState.of(notification.after()));
  }

  private static Change change(MatchEvent event) {
    return switch (event) {
      case MatchEvent.Join join -> new Change.Joined(join.id().uuid(), join.name());
      case MatchEvent.Leave leave -> new Change.Left(leave.id().uuid());
      case MatchEvent.Disconnect gone -> new Change.Left(gone.id().uuid());
      case MatchEvent.PickKit pick -> new Change.KitPicked(pick.id().uuid(), pick.kitId());
      case MatchEvent.ForceKit force -> new Change.KitPicked(force.id().uuid(), force.kitId());
      case MatchEvent.BallotOpened opened ->
          new Change.BallotOpened(opened.candidates().stream().map(c -> c.mapId()).toList());
      case MatchEvent.Vote vote -> new Change.Voted(vote.id().uuid(), vote.mapId());
      case MatchEvent.MapReady ready ->
          new Change.MapReady(ready.map().id(), ready.map().blocksSha256());
      case MatchEvent.MapFailed failed -> new Change.MapFailed(failed.mapId());
      case MatchEvent.SetMap _, MatchEvent.Skip _, MatchEvent.Extend _, MatchEvent.AssignTeam _ ->
          new Change.Operated();
      case MatchEvent.Damaged damaged ->
          new Change.Damaged(damaged.victim().uuid(), damaged.attacker().map(CombatantId::uuid));
      case MatchEvent.Tick _ -> new Change.Ticked();
      case MatchEvent.ForceStart _ -> new Change.ForceStarted();
      case MatchEvent.Stop _ -> new Change.Stopped();
      case MatchEvent.Died died ->
          new Change.Died(died.victim().uuid(), died.killer().map(CombatantId::uuid));
      case MatchEvent.BombClicked click ->
          new Change.BombClicked(click.id().uuid(), click.bombId());
      case MatchEvent.ResetDone _ -> new Change.Reset();
      case MatchEvent.LookedAround looked -> new Change.LookedAround(looked.id().uuid());
    };
  }

  private static Optional<Effect> effect(MatchEffect effect) {
    return switch (effect) {
      case MatchEffect.Teleport teleport -> {
        var to = teleport.to().position();
        yield Optional.of(new Effect.Teleported(teleport.id().uuid(), to.x(), to.y(), to.z()));
      }
      case MatchEffect.Equip equip ->
          Optional.of(new Effect.Equipped(equip.id().uuid(), equip.kitId()));
      case MatchEffect.Restore restore -> Optional.of(new Effect.Restored(restore.id().uuid()));
      case MatchEffect.Spectate spectate ->
          Optional.of(new Effect.Spectating(spectate.id().uuid()));
      case MatchEffect.RecordStat stat ->
          Optional.of(new Effect.StatRecorded(stat.id().uuid(), stat.stat()));
      case MatchEffect.Kill kill ->
          Optional.of(new Effect.Killed(kill.victims().stream().map(CombatantId::uuid).toList()));
      case MatchEffect.CaptureSnapshot _,
          MatchEffect.EnterLobby _,
          MatchEffect.ReturnToLobby _,
          MatchEffect.NeedBallot _,
          MatchEffect.PrepareMap _,
          MatchEffect.PreviewMap _,
          MatchEffect.Freeze _,
          MatchEffect.Unfreeze _,
          MatchEffect.Death _,
          MatchEffect.GiveFuse _,
          MatchEffect.Announce _,
          MatchEffect.Tell _,
          MatchEffect.Sound _,
          MatchEffect.SoundAt _,
          MatchEffect.SetTime _,
          MatchEffect.BombArmed _,
          MatchEffect.BombRestored _,
          MatchEffect.BombRemoved _,
          MatchEffect.Explode _,
          MatchEffect.Crater _,
          MatchEffect.PoisonDamage _,
          MatchEffect.StripFood _,
          MatchEffect.RevertCraters _,
          MatchEffect.Pay _ ->
          Optional.empty();
    };
  }
}
