package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Every kit ability in a live match: each holder's {@link KitState} and cooldowns, what each kit
 * remembers across all its holders, where everyone stood at the last tick, and what kits have
 * placed. Immutable; each match event produces the next one and the effects to carry out.
 *
 * @param states each combatant's ability state
 * @param shared what an ability remembers across all its holders (a Medic's heals given to each
 *     ally, Frost's frozen victims), by ability id
 * @param cooldowns each combatant's cooldowns: key to when it is ready
 * @param positions where each living combatant stood at the last tick
 * @param placed what kits have placed, oldest first
 * @param fielded how many combatants the match went live with
 * @param online how many players were on the server when the match went live, as Red Warfare
 *     counted them for the Medic's small-game rule; before then, how many are on it now
 */
public record Abilities(
    Map<CombatantId, KitState> states,
    Map<String, KitState> shared,
    Map<CombatantId, Map<String, Instant>> cooldowns,
    Map<CombatantId, Vec3> positions,
    List<Placed> placed,
    int fielded,
    int online) {

  /** No match live. */
  public static final Abilities NONE =
      new Abilities(Map.of(), Map.of(), Map.of(), Map.of(), List.of(), 0, 0);

  public Abilities {
    states = Map.copyOf(states);
    shared = Map.copyOf(shared);
    var copied = new HashMap<CombatantId, Map<String, Instant>>();
    cooldowns.forEach((id, keys) -> copied.put(id, Map.copyOf(keys)));
    cooldowns = Map.copyOf(copied);
    positions = Map.copyOf(positions);
    placed = List.copyOf(placed);
  }

  /**
   * What the abilities see of the match for one event.
   *
   * @param now the event's time
   * @param random the match's randomness for it
   * @param fighters everyone on a team, living or not
   * @param bombs the blocks of the bombs still standing
   * @param endgame whether the end-of-game poison has begun
   * @param ground what the map's blocks say about a spot, read for a tick
   */
  public record Board(
      Instant now,
      RandomGenerator random,
      List<Fighter> fighters,
      List<BlockPos> bombs,
      boolean endgame,
      Ground ground) {

    public Board {
      fighters = List.copyOf(fighters);
      bombs = List.copyOf(bombs);
    }

    /** A board before the poison, for an event that reads no ground. */
    public Board(
        Instant now, RandomGenerator random, List<Fighter> fighters, List<BlockPos> bombs) {
      this(now, random, fighters, bombs, false, Ground.UNREAD);
    }
  }

  /**
   * An event's outcome.
   *
   * @param abilities the abilities afterwards
   * @param effects what the server must do, in order
   * @param uses the active uses the event was, for stats and recordings
   */
  public record Step(
      Abilities abilities, List<AbilityEffect> effects, List<AbilityEffect.Used> uses) {

    public Step {
      effects = List.copyOf(effects);
      uses = List.copyOf(uses);
    }
  }

  /** {@code id}'s state; {@link KitState#NONE} when they hold none. */
  public KitState state(CombatantId id) {
    return states.getOrDefault(id, KitState.NONE);
  }

  /** Whether {@code id}, fighting with {@code kit}, looks to the enemy like one of their own. */
  public boolean disguised(CombatantId id, String kit) {
    return abilityOf(kit).filter(ability -> ability.disguised(state(id))).isPresent();
  }

  /**
   * What ability {@code ability} remembers across its holders; {@link KitState#NONE} if nothing.
   */
  public KitState shared(String ability) {
    return shared.getOrDefault(ability, KitState.NONE);
  }

  /** Whether {@code id}'s cooldown {@code key} has run out at {@code now}. */
  public boolean ready(CombatantId id, String key, Instant now) {
    var at = cooldowns.getOrDefault(id, Map.of()).get(key);
    return at == null || !now.isBefore(at);
  }

  /** When {@code id}'s cooldown {@code key} runs out, if it is running at {@code now}. */
  public Optional<Instant> readyAt(CombatantId id, String key, Instant now) {
    var at = cooldowns.getOrDefault(id, Map.of()).get(key);
    return at == null || !now.isBefore(at) ? Optional.empty() : Optional.of(at);
  }

  /** What kits placed on {@code block}, if anything. */
  public Optional<Placed> placedAt(BlockPos block) {
    return placed.stream().filter(thing -> thing.blocks().contains(block)).findFirst();
  }

  /** The ability {@code kit} carries, if any. */
  public static Optional<Ability> abilityOf(String kit) {
    return KitBook.byId(kit).flatMap(KitSpec::ability).flatMap(AbilityBook::byId);
  }

  /**
   * How many players are on the server, kept until the match goes live; a live match keeps the
   * count it went live with.
   */
  public Abilities withOnline(int players) {
    if (players < 0) {
      throw new IllegalArgumentException("players online must not be negative: " + players);
    }
    return new Abilities(states, shared, cooldowns, positions, placed, fielded, players);
  }

  /**
   * The match went live with {@code online} players on the server: every fighter's ability starts.
   */
  public static Step start(Board board, int online) {
    var engine = new Engine(NONE, board);
    engine.fielded = board.fighters().size();
    engine.online = online;
    for (var fighter : board.fighters()) {
      abilityOf(fighter.kit())
          .ifPresent(ability -> engine.state(fighter.id(), ability.start(fighter, engine)));
    }
    return engine.step();
  }

  /** {@code actor} did {@code input}. */
  public Step act(Board board, CombatantId actor, AbilityInput input) {
    var engine = new Engine(this, board);
    var self = engine.fighter(actor).filter(Fighter::alive);
    if (self.isEmpty()) {
      return engine.step();
    }
    switch (input) {
      case AbilityInput.Hit hit -> {
        abilityOf(self.orElseThrow().kit())
            .ifPresent(ability -> ability.hit(self.orElseThrow(), hit, engine));
        engine
            .fighter(hit.victim())
            .ifPresent(
                victim ->
                    engine.hurt(
                        victim,
                        new AbilityInput.Hurt(Optional.of(actor), hit.type(), hit.damage())));
      }
      case AbilityInput.Hurt hurt -> engine.hurt(self.orElseThrow(), hurt);
      case AbilityInput.Touch touch -> engine.touch(self.orElseThrow(), touch);
      default ->
          abilityOf(self.orElseThrow().kit())
              .ifPresent(
                  ability -> {
                    var before = engine.effects.size();
                    ability.act(self.orElseThrow(), input, engine);
                    engine.used(actor, ability.id(), input, before);
                  });
    }
    return engine.step();
  }

  /** One server tick: everyone's motion, then every ability's own clock. */
  public Step tick(Board board, Map<CombatantId, Motion> motions) {
    var engine = new Engine(this, board);
    for (var fighter : engine.living()) {
      var motion = motions.get(fighter.id());
      if (motion == null) {
        continue;
      }
      engine.positions.put(fighter.id(), motion.position());
      abilityOf(fighter.kit()).ifPresent(ability -> ability.tick(fighter, motion, engine));
    }
    for (var ability : AbilityBook.ALL) {
      ability.anyTick(engine);
    }
    return engine.step();
  }

  /** The match ended: every living holder's ability hears of it. */
  public Step ended(Board board) {
    var engine = new Engine(this, board);
    for (var fighter : engine.living()) {
      abilityOf(fighter.kit()).ifPresent(ability -> ability.ended(fighter, engine));
    }
    return engine.step();
  }

  /** {@code death} happened: the victim's ability, then every living holder's, hear of it. */
  public Step died(Board board, Death death) {
    var engine = new Engine(this, board);
    engine
        .fighter(death.victim())
        .ifPresent(
            victim ->
                abilityOf(victim.kit()).ifPresent(ability -> ability.died(victim, death, engine)));
    for (var fighter : engine.living()) {
      if (!fighter.id().equals(death.victim())) {
        abilityOf(fighter.kit()).ifPresent(ability -> ability.died(fighter, death, engine));
      }
    }
    for (var ability : AbilityBook.ALL) {
      ability.anyDeath(death, engine);
    }
    engine.positions.remove(death.victim());
    return engine.step();
  }

  /** The {@link Arena} over a working copy of the abilities, for one event. */
  private static final class Engine implements Arena {

    private final Board board;
    private final Map<CombatantId, KitState> states;
    private final Map<String, KitState> shared;
    private final Map<CombatantId, Map<String, Instant>> cooldowns = new HashMap<>();
    private final Map<CombatantId, Vec3> positions;
    private final List<Placed> placed;
    private final List<AbilityEffect> effects = new ArrayList<>();
    private final List<AbilityEffect.Used> uses = new ArrayList<>();
    private int fielded;
    private int online;

    Engine(Abilities from, Board board) {
      this.board = board;
      this.states = new HashMap<>(from.states());
      this.shared = new HashMap<>(from.shared());
      from.cooldowns().forEach((id, keys) -> cooldowns.put(id, new HashMap<>(keys)));
      this.positions = new HashMap<>(from.positions());
      this.placed = new ArrayList<>(from.placed());
      this.fielded = from.fielded();
      this.online = from.online();
    }

    Step step() {
      return new Step(
          new Abilities(states, shared, cooldowns, positions, placed, fielded, online),
          effects,
          uses);
    }

    /**
     * {@code actor}'s {@code input} to {@code ability} was a use if the kit answered it, since
     * effect {@code before}, with more than a refusal. A projectile going off is not a new use.
     */
    void used(CombatantId actor, String ability, AbilityInput input, int before) {
      // A projectile going off and the server's once-a-second stock count are not uses.
      if (input instanceof AbilityInput.Detonate
          || input instanceof AbilityInput.Stock
          || input instanceof ExpansionInput.FlaskSplash) {
        return;
      }
      var answered =
          effects.subList(before, effects.size()).stream()
              .anyMatch(
                  effect ->
                      !(effect instanceof AbilityEffect.Say say
                          && say.tone() == AbilityEffect.Tone.REFUSED));
      if (answered) {
        uses.add(new AbilityEffect.Used(actor, ability, target(input)));
      }
    }

    private static Optional<CombatantId> target(AbilityInput input) {
      return switch (input) {
        case AbilityInput.Bond bond -> Optional.of(bond.ally());
        case AbilityInput.Warp warp -> warp.targets().stream().findFirst();
        case AbilityInput.PlaceTeleporter place -> place.remote();
        default -> Optional.empty();
      };
    }

    /** {@code victim} was hurt: their own ability, then every ability watching anyone, hear. */
    void hurt(Fighter victim, AbilityInput.Hurt hurt) {
      abilityOf(victim.kit()).ifPresent(ability -> ability.hurt(victim, hurt, this));
      for (var ability : AbilityBook.ALL) {
        ability.anyHurt(victim, hurt, this);
      }
    }

    /** {@code actor} touched something a kit placed: its owner's ability answers. */
    void touch(Fighter actor, AbilityInput.Touch touch) {
      var thing = placed.stream().filter(p -> p.blocks().contains(touch.block())).findFirst();
      if (thing.isEmpty()) {
        return;
      }
      var owner = fighter(thing.orElseThrow().owner());
      if (owner.isEmpty()) {
        return;
      }
      abilityOf(owner.orElseThrow().kit())
          .ifPresent(ability -> ability.touched(owner.orElseThrow(), actor, touch, this));
    }

    @Override
    public Instant now() {
      return board.now();
    }

    @Override
    public RandomGenerator random() {
      return board.random();
    }

    @Override
    public Optional<Fighter> fighter(CombatantId id) {
      return board.fighters().stream().filter(fighter -> fighter.id().equals(id)).findFirst();
    }

    @Override
    public List<Fighter> living() {
      return board.fighters().stream().filter(Fighter::alive).toList();
    }

    @Override
    public int fielded() {
      return fielded;
    }

    @Override
    public int online() {
      return online;
    }

    @Override
    public boolean endgame() {
      return board.endgame();
    }

    @Override
    public Optional<Vec3> position(CombatantId id) {
      return Optional.ofNullable(positions.get(id));
    }

    @Override
    public List<BlockPos> bombs() {
      return board.bombs();
    }

    @Override
    public boolean safe(Vec3 feet) {
      return board.ground().safe(feet);
    }

    @Override
    public <S extends KitState> S state(CombatantId id, Class<S> type) {
      var state = states.getOrDefault(id, KitState.NONE);
      if (!type.isInstance(state)) {
        throw new IllegalStateException(id + " holds " + state + ", not a " + type.getSimpleName());
      }
      return type.cast(state);
    }

    @Override
    public void state(CombatantId id, KitState state) {
      states.put(id, state);
    }

    @Override
    public <S extends KitState> Optional<S> shared(String ability, Class<S> type) {
      var state = shared.get(ability);
      if (state == null) {
        return Optional.empty();
      }
      if (!type.isInstance(state)) {
        throw new IllegalStateException(ability + " shares " + state + ", not a " + type);
      }
      return Optional.of(type.cast(state));
    }

    @Override
    public void shared(String ability, KitState state) {
      shared.put(ability, state);
    }

    @Override
    public boolean ready(CombatantId id, String key) {
      return left(id, key).isZero();
    }

    @Override
    public Duration left(CombatantId id, String key) {
      var at = cooldowns.getOrDefault(id, Map.of()).get(key);
      if (at == null || !now().isBefore(at)) {
        return Duration.ZERO;
      }
      return Duration.between(now(), at);
    }

    @Override
    public void use(CombatantId id, String key, Duration length, boolean shown) {
      cooldowns.computeIfAbsent(id, ignored -> new HashMap<>()).put(key, now().plus(length));
      if (shown) {
        effect(new AbilityEffect.Cooldown(id, key, length));
      }
    }

    @Override
    public List<Placed> placed() {
      return List.copyOf(placed);
    }

    @Override
    public void place(Placed thing) {
      placed.add(thing);
    }

    @Override
    public void unplace(Placed thing) {
      placed.remove(thing);
    }

    @Override
    public void replace(Placed before, Placed after) {
      var index = placed.indexOf(before);
      if (index < 0) {
        throw new IllegalStateException("nothing to replace: " + before);
      }
      placed.set(index, after);
    }

    @Override
    public void effect(AbilityEffect effect) {
      effects.add(effect);
    }
  }
}
