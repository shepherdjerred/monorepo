package com.shepherdjerred.thestorm.rwfbots;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.map.BombOwner;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.map.MapTeam;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * rwf's app ports over a hand-driven match on the synthetic map: tests set the phase and the
 * members, fire transitions, and read what actions the bots asked for. Every action is accepted.
 */
public final class FakeMatch implements MatchView, MatchEvents, CombatantActions {

  public static final UUID MATCH_ID = UUID.fromString("00000000-0000-0000-0000-00000000abcd");
  public static final Instant T0 = Instant.parse("2026-10-03T12:00:00Z");
  public static final String RED_BOMB = "red-1";
  public static final String BLUE_BOMB = "blue-1";

  /** One member as the fake match knows them. */
  public record Member(
      CombatantId id, String name, Optional<TeamColor> team, Optional<String> kit, boolean alive) {

    public Member with(Optional<TeamColor> newTeam, Optional<String> newKit) {
      return new Member(id, name, newTeam, newKit, alive);
    }

    public Member dead() {
      return new Member(id, name, team, kit, false);
    }
  }

  private final MapDefinition map;
  private final List<Consumer<MatchNotification>> listeners = new ArrayList<>();
  private final Map<UUID, Member> members = new LinkedHashMap<>();
  private final List<String> actions = new ArrayList<>();
  private MatchSnapshot.PhaseKind phase = MatchSnapshot.PhaseKind.LOBBY;
  private Optional<Outcome> outcome = Optional.empty();
  private boolean redArmed;

  public FakeMatch(String blocksSha256) {
    this.map = map(blocksSha256);
  }

  /** The synthetic map as rwf would define it: red west, blue east, one bomb each. */
  public static MapDefinition map(String blocksSha256) {
    return new MapDefinition(
        "synthetic",
        "Synthetic",
        "tests",
        List.of(
            new MapTeam(TeamColor.RED, List.of(new Spawn(new Vec3(2.5, 1, 2.5), 0, 0))),
            new MapTeam(TeamColor.BLUE, List.of(new Spawn(new Vec3(30.5, 1, 30.5), 180, 0)))),
        List.of(
            new BombSite(RED_BOMB, new BombOwner.Team(TeamColor.RED), new BlockPos(4, 1, 16)),
            new BombSite(BLUE_BOMB, new BombOwner.Team(TeamColor.BLUE), new BlockPos(28, 1, 16))),
        new Cuboid(new BlockPos(0, 0, 0), new BlockPos(31, 7, 31)),
        Spawn.at(new BlockPos(16, 2, 16)),
        Spawn.at(new BlockPos(16, 3, 16)),
        blocksSha256);
  }

  public MapDefinition map() {
    return map;
  }

  // ---- driving -------------------------------------------------------------------------------

  public void phase(MatchSnapshot.PhaseKind next) {
    phase = next;
  }

  public void outcome(Outcome result) {
    outcome = Optional.of(result);
  }

  public void redArmed(boolean armed) {
    redArmed = armed;
  }

  public void fighting(UUID uuid, TeamColor team, String kit) {
    var member = member(uuid);
    members.put(
        uuid, new Member(member.id(), member.name(), Optional.of(team), Optional.of(kit), true));
  }

  public void kill(UUID uuid) {
    members.put(uuid, member(uuid).dead());
  }

  public Member member(UUID uuid) {
    var member = members.get(uuid);
    if (member == null) {
      throw new IllegalArgumentException("not a member: " + uuid);
    }
    return member;
  }

  private void members(CombatantId id, String name) {
    members.put(id.uuid(), new Member(id, name, Optional.empty(), Optional.empty(), false));
  }

  /** Delivers {@code event} with {@code effects} and the current snapshot to every listener. */
  public void fire(MatchEvent event, List<MatchEffect> effects) {
    var notification = new MatchNotification(event, effects, snapshot());
    for (var listener : List.copyOf(listeners)) {
      listener.accept(notification);
    }
  }

  public void fireJoin(CombatantId id, String name) {
    members(id, name);
    fire(new MatchEvent.Join(id, name, T0), List.of());
  }

  public void fireMapChosen() {
    fire(new MatchEvent.MapChosen(map), List.of());
  }

  public void fireTick() {
    fire(MatchEvent.Tick.at(T0), List.of());
  }

  // ---- the ports -----------------------------------------------------------------------------

  public MatchSnapshot snapshot() {
    return new MatchSnapshot(
        MATCH_ID,
        phase,
        T0,
        Optional.of(map.id()),
        map.teamColors(),
        members.values().stream()
            .map(
                m ->
                    new MatchSnapshot.CombatantView(m.id(), m.name(), m.team(), m.kit(), m.alive()))
            .toList(),
        phase == MatchSnapshot.PhaseKind.LOBBY || phase == MatchSnapshot.PhaseKind.COUNTDOWN
            ? List.of()
            : List.of(
                new MatchSnapshot.BombView(
                    RED_BOMB,
                    false,
                    Optional.of(TeamColor.RED),
                    new BlockPos(4, 1, 16),
                    redArmed
                        ? new MatchSnapshot.BombView.State.Armed(40, Optional.empty())
                        : new MatchSnapshot.BombView.State.Idle()),
                new MatchSnapshot.BombView(
                    BLUE_BOMB,
                    false,
                    Optional.of(TeamColor.BLUE),
                    new BlockPos(28, 1, 16),
                    new MatchSnapshot.BombView.State.Idle())),
        Optional.empty(),
        outcome);
  }

  @Override
  public Optional<MatchSnapshot> current() {
    return Optional.of(snapshot());
  }

  @Override
  public Subscription subscribe(Consumer<MatchNotification> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  public int listeners() {
    return listeners.size();
  }

  /** Every action asked for since the last call, as {@code <kind> <who> <what>}. */
  public List<String> actions() {
    var copy = List.copyOf(actions);
    actions.clear();
    return copy;
  }

  private Optional<ActionRefusal> record(String kind, CombatantId who, String what) {
    actions.add(kind + " " + member(who.uuid()).name() + " " + what);
    return Optional.empty();
  }

  @Override
  public Optional<ActionRefusal> clickBomb(CombatantId id, String bombId) {
    return record("bomb", id, bombId);
  }

  @Override
  public Optional<ActionRefusal> useRewind(CombatantId id) {
    return record("rewind", id, "");
  }

  @Override
  public Optional<ActionRefusal> melee(CombatantId attacker, CombatantId target) {
    return record("melee", attacker, member(target.uuid()).name());
  }

  @Override
  public Optional<ActionRefusal> shootBow(CombatantId id, Vec3 direction, double force) {
    return record("shoot", id, String.valueOf(force));
  }

  @Override
  public Optional<ActionRefusal> consume(CombatantId id, int slot) {
    return record("consume", id, String.valueOf(slot));
  }

  @Override
  public Optional<ActionRefusal> pickKit(CombatantId id, String kitId) {
    members.put(id.uuid(), member(id.uuid()).with(Optional.empty(), Optional.of(kitId)));
    return record("kit", id, kitId);
  }
}
