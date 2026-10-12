package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.ability.Abilities;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.Ground;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;

/**
 * Kit abilities inside a match: the live match starts them, its events reach them, and what they do
 * becomes {@link MatchEffect.Ability} effects. Abilities answer only in a live match.
 */
final class Kits {

  private Kits() {}

  /** What the abilities see of {@code draft} at {@code now}. */
  static Abilities.Board board(Draft draft, Instant now) {
    return board(draft, now, Ground.UNREAD);
  }

  /** What the abilities see of {@code draft} at {@code now}, standing on {@code ground}. */
  static Abilities.Board board(Draft draft, Instant now, Ground ground) {
    var fighters = new ArrayList<Fighter>();
    for (var member : draft.members()) {
      if (member.team().isPresent() && member.kit().isPresent()) {
        fighters.add(
            new Fighter(
                member.id(),
                member.name(),
                member.team().orElseThrow(),
                member.kit().orElseThrow(),
                member.alive()));
      }
    }
    var bombs = new ArrayList<BlockPos>();
    for (var bomb : draft.bombs()) {
      if (!bomb.destroyed()) {
        bombs.add(bomb.site().position());
      }
    }
    var endgame = draft.phase instanceof Phase.Live live && live.poison().endGame(now);
    return new Abilities.Board(now, draft.random(now), fighters, bombs, endgame, ground);
  }

  /** The match went live: every fighter's ability starts. */
  static void start(Draft draft, Instant now) {
    apply(draft, Abilities.start(board(draft, now), draft.abilities.online()));
  }

  /** The match ended: living holders' abilities hear of it. */
  static void ended(Draft draft, Instant now) {
    apply(draft, draft.abilities.ended(board(draft, now)));
  }

  /**
   * {@code players} are on the server now. Counted until the match goes live, as Red Warfare read
   * the count when its abilities registered; a live or ended match keeps the count it went live
   * with.
   */
  static void online(Draft draft, int players) {
    if (!(draft.phase instanceof Phase.Live) && !(draft.phase instanceof Phase.Ended)) {
      draft.abilities = draft.abilities.withOnline(players);
    }
  }

  /** A combatant's kit acted. Refused outside a live match. */
  static Optional<MatchError> act(Draft draft, MatchEvent.Ability ability) {
    if (!(draft.phase instanceof Phase.Live)) {
      return Optional.of(MatchError.NOT_LIVE);
    }
    var member = draft.member(ability.actor());
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    if (!member.orElseThrow().alive()) {
      return Optional.of(MatchError.NOT_ALIVE);
    }
    apply(
        draft, draft.abilities.act(board(draft, ability.now()), ability.actor(), ability.input()));
    return Optional.empty();
  }

  /** One tick of a live match. */
  static void tick(Draft draft, MatchEvent.Tick tick) {
    apply(draft, draft.abilities.tick(board(draft, tick.now(), tick.ground()), tick.motions()));
  }

  /**
   * A combatant lost: died, or left a live match.
   *
   * @param victim who
   * @param attribution who the death is credited to, with the assists, and how it happened
   * @param now when
   */
  record Loss(CombatantId victim, Attribution attribution, Instant now) {}

  /** A combatant died or left a live match. */
  static void died(Draft draft, Loss loss) {
    if (!(draft.phase instanceof Phase.Live)) {
      return;
    }
    var at = draft.abilities.positions().get(loss.victim());
    apply(
        draft,
        draft.abilities.died(
            board(draft, loss.now()),
            new Death(
                loss.victim(),
                loss.attribution().killer(),
                loss.attribution().assists(),
                loss.attribution().cause(),
                Optional.ofNullable(at))));
  }

  private static void apply(Draft draft, Abilities.Step step) {
    draft.abilities = step.abilities();
    for (var effect : step.effects()) {
      draft.effect(new MatchEffect.Ability(effect));
    }
    for (var use : step.uses()) {
      draft.effect(new MatchEffect.Ability(use));
    }
  }
}
