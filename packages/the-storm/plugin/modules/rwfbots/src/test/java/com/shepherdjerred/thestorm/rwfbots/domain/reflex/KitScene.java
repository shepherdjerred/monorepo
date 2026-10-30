package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;

import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * One tick in front of a kit-carrying bot, built up a piece at a time for the kit-moment tests.
 *
 * @param self the bot
 * @param option what it has decided to do
 * @param stance how it goes about it
 * @param target the enemy it fights, if any
 * @param others everyone else on the field, allies and enemies; every enemy is in sight
 * @param waypoints its path
 * @param bombs the bombs on the field; the decision names the first
 * @param tick the snapshot tick
 */
record KitScene(
    CombatantView self,
    Option option,
    Stance stance,
    Optional<CombatantView> target,
    List<CombatantView> others,
    List<Waypoint> waypoints,
    List<BombView> bombs,
    long tick) {

  /** A healthy bot of {@code kit} standing still on the ground at {@code at}, on its own. */
  static KitScene of(Kit kit, TeamId team, Vec3 at) {
    var self = withKit(combatant(1, team, at), kit);
    return new KitScene(
        self,
        Option.TAKE_SLOT,
        Stance.AGGRESSIVE,
        Optional.empty(),
        List.of(),
        List.of(),
        List.of(),
        100);
  }

  /** {@code view} playing {@code kit}. */
  static CombatantView withKit(CombatantView view, Kit kit) {
    return new CombatantView(
        view.id(),
        view.team(),
        view.disguised(),
        kit,
        view.alive(),
        view.pos(),
        view.vel(),
        view.yaw(),
        view.pitch(),
        view.health(),
        view.absorption(),
        view.armorValue(),
        view.heldSlot(),
        view.sprinting(),
        view.onGround(),
        view.usingItem(),
        view.invisible(),
        view.lastHurtTick(),
        view.traversal(),
        view.quiver(),
        view.sneaking(),
        view.nameHidden(),
        false);
  }

  KitScene self(CombatantView newSelf) {
    return new KitScene(newSelf, option, stance, target, others, waypoints, bombs, tick);
  }

  KitScene health(double health) {
    return self(self.withHealth(health, 0));
  }

  KitScene doing(Option newOption, Stance newStance) {
    return new KitScene(self, newOption, newStance, target, others, waypoints, bombs, tick);
  }

  KitScene fighting(CombatantView enemy) {
    return new KitScene(self, option, stance, Optional.of(enemy), others, waypoints, bombs, tick);
  }

  KitScene with(CombatantView... more) {
    var all = new ArrayList<>(others);
    all.addAll(List.of(more));
    return new KitScene(self, option, stance, target, all, waypoints, bombs, tick);
  }

  KitScene path(Waypoint... newWaypoints) {
    return new KitScene(self, option, stance, target, others, List.of(newWaypoints), bombs, tick);
  }

  KitScene bomb(BombView bomb) {
    return new KitScene(self, option, stance, target, others, waypoints, List.of(bomb), tick);
  }

  /** The tick's input: every enemy on the field and the target are in sight, nearest first. */
  ReflexInput input() {
    var views = new ArrayList<CombatantView>();
    views.add(self);
    views.addAll(others);
    target.filter(enemy -> !others.contains(enemy)).ifPresent(views::add);
    var world =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            views,
            bombs,
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of(),
            List.of());
    var decision =
        new Decision(
            self.id(),
            option,
            target.map(CombatantView::id),
            waypoints,
            stance,
            bombs.stream().findFirst().map(BombView::id),
            Optional.empty(),
            Optional.empty(),
            "kit scene",
            tick,
            0,
            Optional.empty());
    var seen =
        views.stream()
            .filter(view -> !view.team().equals(self.team()))
            .sorted(java.util.Comparator.comparingDouble(view -> view.pos().distance(self.pos())))
            .toList();
    return new ReflexInput(self, world, decision, target, 0, seen, Optional.empty());
  }

  /** The kit's one item, as its hotbar holds it. */
  static Loadout.KitItem item(Kit kit) {
    return Loadouts.rwf(kit).kitItems().getFirst();
  }

  /** A bomb with this id at {@code at}. */
  static BombView bombAt(int id, TeamId owner, Vec3 at) {
    return new BombView(
        new BombId(id),
        new com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner.Team(owner),
        at,
        new com.shepherdjerred.thestorm.rwfbots.domain.world.BombState.Idle());
  }
}
