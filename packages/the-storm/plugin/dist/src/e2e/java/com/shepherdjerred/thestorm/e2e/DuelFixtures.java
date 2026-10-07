package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.ShowcaseControl;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatAction;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatCommands;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;
import tools.jackson.databind.json.JsonMapper;

/**
 * Console-only, disposable actual-Paper duel bridge. This class exists only in the fixtures jar.
 */
final class DuelFixtures implements BasicCommand, CombatHarness.Controller, Listener {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final DuelProtocol PROTOCOL = DuelProtocol.load();
  private final JavaPlugin plugin;
  private Optional<MatchEvents.Subscription> subscription = Optional.empty();
  private Optional<UUID> match = Optional.empty();
  private Optional<UUID> candidate = Optional.empty();
  private Optional<CombatHarness.Frame> latest = Optional.empty();
  private Optional<ActionTicket> action = Optional.empty();
  private final java.util.ArrayDeque<CombatHarness.Frame> contexts = new java.util.ArrayDeque<>();
  private final java.util.IdentityHashMap<EntityDamageByEntityEvent, Double> healthBefore =
      new java.util.IdentityHashMap<>();
  private final Map<CombatantId, Vec3> seen = new java.util.HashMap<>();
  private final Map<CombatantId, Decision> pursuit = new java.util.HashMap<>();
  private String side = "red";
  private String mode = "authored";
  private String opponent = "basic";
  private long seed;
  private long started;
  private long acceptedTick = -1;
  private long applied;
  private long fallback;
  private double dealt;
  private double received;
  private double sampledDealt;
  private double sampledReceived;
  private long sampleTick;
  private final java.util.ArrayDeque<Long> used = new java.util.ArrayDeque<>();
  private String result = "waiting";

  DuelFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("rwflearn", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  private TheStormPlugin storm() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm;
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source
          .getSender()
          .sendMessage(Component.text("rwflearn requires the disposable server console"));
      return;
    }
    try {
      if (args.length == 0)
        throw new IllegalArgumentException(
            "begin <seed> <red|blue> <authored|external>, state, act <match> <body> <life> <tick> <move> <jump> <sneak> <sprint> <attack>, cancel");
      switch (args[0]) {
        case "begin" -> begin(args);
        case "state" -> {
          if (args.length != 1) throw new IllegalArgumentException("state has no arguments");
        }
        case "act" -> submit(args);
        case "cancel" -> cancel();
        default -> throw new IllegalArgumentException("unknown rwflearn command");
      }
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(state())));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void begin(String[] args) {
    if (args.length < 4 || args.length > 5)
      throw new IllegalArgumentException("begin needs seed, side, mode and optional opponent");
    var nextSeed = Long.parseLong(args[1]);
    if (!List.of("red", "blue").contains(args[2])
        || !List.of("authored", "external").contains(args[3]))
      throw new IllegalArgumentException("invalid side or mode");
    var nextOpponent = args.length == 5 ? args[4] : "basic";
    if (!PROTOCOL.opponents().contains(nextOpponent))
      throw new IllegalArgumentException("unknown duel opponent");
    var current = storm().service(MatchView.class).current().map(MatchState::of).orElseThrow();
    if (current.phase() != MatchState.Phase.LOBBY
        || !current.combatants().isEmpty()
        || !current.mapId().orElseThrow().equals("training-yard"))
      throw new IllegalStateException("need an empty training-yard lobby");
    cancel();
    side = args[2];
    mode = args[3];
    opponent = nextOpponent;
    seed = nextSeed;
    candidate = Optional.empty();
    latest = Optional.empty();
    action = Optional.empty();
    acceptedTick = -1;
    contexts.clear();
    used.clear();
    seen.clear();
    pursuit.clear();
    applied = 0;
    fallback = 0;
    dealt = 0;
    received = 0;
    sampledDealt = 0;
    sampledReceived = 0;
    result = "waiting";
    var control = storm().service(CombatHarness.class);
    control.attach(seed, this);
    subscription =
        Optional.of(
            storm()
                .service(MatchEvents.class)
                .subscribe(notification -> changed(MatchState.of(notification.after()))));
    match = Optional.of(current.matchId());
    var refusal = storm().service(ShowcaseControl.class).start(2);
    if (refusal.isPresent()) {
      cancel();
      throw new IllegalStateException(refusal.orElseThrow());
    }
  }

  private void changed(MatchState current) {
    if (match.filter(current.matchId()::equals).isEmpty()) return;
    if (current.phase() == MatchState.Phase.LIVE && candidate.isEmpty()) {
      spawnDuel(current);
    } else if (current.phase() == MatchState.Phase.ENDED && result.equals("live")) {
      result = current.winner().map(w -> w.equals(side) ? "win" : "loss").orElse("draw");
      action = Optional.empty();
    } else if (current.phase() == MatchState.Phase.RESETTING && result.equals("live")) {
      result = "stopped";
      action = Optional.empty();
    }
  }

  private void spawnDuel(MatchState current) {
    if (current.combatants().size() != 2 || current.combatants().stream().anyMatch(f -> !f.bot()))
      throw new IllegalStateException("duel roster changed");
    for (var fighter : current.combatants()) {
      var player = body(fighter.uuid());
      var red = fighter.team().orElseThrow().equals("red");
      var at = new Location(player.getWorld(), red ? 25.5 : 37.5, 65, 8.5, red ? -90 : 90, 0);
      if (!player.teleport(at)) throw new IllegalStateException("duel teleport refused");
      player.setVelocity(new Vector());
      player.getInventory().setHeldItemSlot(1);
      if (fighter.team().orElseThrow().equals(side)) candidate = Optional.of(fighter.uuid());
    }
    if (candidate.isEmpty()) throw new IllegalStateException("candidate team missing");
    result = "live";
    started = 0;
  }

  private Player body(UUID id) {
    var identity =
        storm()
            .service(MatchView.class)
            .current()
            .map(MatchState::of)
            .orElseThrow()
            .combatant(id)
            .orElseThrow()
            .personalityId()
            .orElseThrow();
    return storm()
        .service(com.shepherdjerred.thestorm.rwf.app.BotRoster.class)
        .entity(new com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId.Bot(identity, id))
        .orElseThrow();
  }

  private void cancel() {
    subscription.ifPresent(MatchEvents.Subscription::close);
    subscription = Optional.empty();
    match.ifPresent(id -> storm().service(ShowcaseControl.class).stop(id));
    storm().service(CombatHarness.class).detach();
    match = Optional.empty();
    action = Optional.empty();
    if (result.equals("live") || result.equals("waiting")) result = "cancelled";
  }

  @Override
  public ReflexInput input(ReflexInput authored, NavArtifact nav) {
    var self = authored.self();
    var target =
        authored.snapshot().aliveEnemiesOf(self.team()).stream()
            .filter(enemy -> Perception.hasLineOfSight(nav.grid(), self.eye(), enemy))
            .min(Comparator.comparingDouble(enemy -> enemy.pos().distance(self.pos())));
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            target.map(enemy -> enemy.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "duel",
            authored.snapshot().tick(),
            authored.decision().lifeEpoch());
    if (target.isPresent()) {
      seen.put(self.id(), target.orElseThrow().pos());
      pursuit.remove(self.id());
    } else {
      decision = pursuit.computeIfAbsent(self.id(), id -> pursuit(authored, nav));
    }
    var gapples =
        self.team().value().equals(side) || opponent.equals("authored")
            ? authored.gapplesLeft()
            : 0;
    return new ReflexInput(self, authored.snapshot(), decision, target, gapples);
  }

  private Decision pursuit(ReflexInput input, NavArtifact nav) {
    var remembered = seen.get(input.self().id());
    var idle =
        Decision.idle(input.self().id(), input.snapshot().tick(), input.decision().lifeEpoch());
    if (remembered == null) return idle;
    var from = nav.graph().nearestNode(input.self().pos());
    var to = nav.graph().nearestNode(remembered);
    if (from.isEmpty() || to.isEmpty()) return idle;
    return nav.graph()
        .path(from.getAsInt(), to.getAsInt(), node -> 0)
        .map(
            path ->
                new Decision(
                    input.self().id(),
                    Option.HUNT,
                    Optional.empty(),
                    path.toFollow(),
                    Stance.AGGRESSIVE,
                    Optional.empty(),
                    Optional.of(remembered.plus(0, 1.3, 0)),
                    Optional.empty(),
                    "duel:last-seen",
                    input.snapshot().tick(),
                    input.decision().lifeEpoch()))
        .orElse(idle);
  }

  @Override
  public void captureTick(long tick) {
    sampleTick = tick;
    sampledDealt = dealt;
    sampledReceived = received;
  }

  @Override
  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    if (!result.equals("live")) return List.of(new BodyCommand.Stop());
    if (started == 0) started = frame.input().snapshot().tick();
    if (frame.input().snapshot().tick() - started >= 1200) {
      result = "timeout";
      storm().service(ShowcaseControl.class).stop(frame.matchId());
      return List.of();
    }
    if (!candidate.filter(frame.body()::equals).isPresent()) {
      return opponent.equals("authored") ? frame.authored().commands() : basic(frame);
    }
    latest = Optional.of(frame);
    contexts.addLast(frame);
    while (contexts.size() > 3) contexts.removeFirst();
    if (!mode.equals("external")) return frame.authored().commands();
    var response =
        action.filter(
            ticket ->
                ticket.applies(
                    frame.matchId(), frame.body(), frame.life(), frame.input().snapshot().tick()));
    if (response.isEmpty()
        || !CombatCommands.eligible(frame.authored().commands(), frame.input())) {
      fallback++;
      return frame.authored().commands();
    }
    applied++;
    var usedTick = response.orElseThrow().tick();
    if (!used.contains(usedTick)) used.addLast(usedTick);
    while (used.size() > 4) used.removeFirst();
    return CombatCommands.replace(
        frame.authored().commands(), frame.input(), response.orElseThrow());
  }

  private List<BodyCommand> basic(CombatHarness.Frame frame) {
    if (opponent.equals("stationary"))
      return List.of(new BodyCommand.SelectSlot(1), new BodyCommand.Stop());
    var input = frame.input();
    var target = input.target();
    if (target.isEmpty()) return frame.authored().commands();
    var self = input.self();
    var enemy = target.orElseThrow();
    var forward = enemy.pos().minus(self.pos()).horizontal().normalized();
    var side = new Vec3(-forward.z(), 0, forward.x());
    var distance = enemy.pos().distance(self.pos());
    var closing = distance > 2.7 ? 1.0 : distance < 2.3 ? -1.0 : 0.0;
    var elapsed = input.snapshot().tick() - started;
    var sign = ((elapsed / 20) & 1) == 0 ? 1.0 : -1.0;
    var strafe = opponent.equals("chase") ? 0 : sign * 0.5;
    var move = forward.scale(closing).plus(side.scale(strafe)).normalized();
    var look = Facing.looking(self.eye(), enemy.pos().plus(0, 1.0, 0));
    var commands = new ArrayList<BodyCommand>();
    commands.add(new BodyCommand.SelectSlot(1));
    commands.add(new BodyCommand.Sneak(false));
    commands.add(new BodyCommand.Look(look.yaw(), look.pitch()));
    commands.add(new BodyCommand.MoveToward(self.pos().plus(move), true));
    if ((elapsed & 1) == 0) {
      commands.add(new BodyCommand.Swing());
      commands.add(new BodyCommand.Attack(enemy.id()));
    }
    return List.copyOf(commands);
  }

  private void submit(String[] args) {
    if (args.length != 10 || !mode.equals("external") || !result.equals("live"))
      throw new IllegalArgumentException("act requires an external live duel and nine fields");
    var tick = Long.parseLong(args[4]);
    var current = latest.orElseThrow();
    var now = current.input().snapshot().tick();
    var frame =
        contexts.stream()
            .filter(context -> context.input().snapshot().tick() == tick)
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("observation context expired"));
    var ticket =
        new ActionTicket(
            UUID.fromString(args[1]),
            UUID.fromString(args[2]),
            Integer.parseInt(args[3]),
            tick,
            frame.input().self().yaw(),
            new CombatAction(
                Integer.parseInt(args[5]), bit(args[6]), bit(args[7]), bit(args[8]), bit(args[9])));
    if (tick <= acceptedTick
        || !ticket.applies(current.matchId(), current.body(), current.life(), now))
      throw new IllegalArgumentException("stale, duplicate or wrong-context action");
    acceptedTick = tick;
    action = Optional.of(ticket);
  }

  private static boolean bit(String text) {
    return switch (text) {
      case "0" -> false;
      case "1" -> true;
      default -> throw new IllegalArgumentException("action bits must be 0 or 1");
    };
  }

  private Map<String, Object> state() {
    var current = storm().service(MatchView.class).current().map(MatchState::of).orElseThrow();
    var state = new java.util.LinkedHashMap<String, Object>();
    state.put("protocol", PROTOCOL.version());
    state.put("contract", PROTOCOL.contract());
    state.put("seed", seed);
    state.put("side", side);
    state.put("mode", mode);
    state.put("opponent", opponent);
    state.put("result", result.equals("live") && latest.isEmpty() ? "waiting" : result);
    state.put("phase", current.phase().name());
    state.put("match", match.map(UUID::toString).orElse(""));
    state.put("dealt", dealt);
    state.put("received", received);
    state.put("sampleDealt", result.equals("live") ? sampledDealt : dealt);
    state.put("sampleReceived", result.equals("live") ? sampledReceived : received);
    state.put("sampleTick", sampleTick);
    state.put("used", List.copyOf(used));
    state.put("applied", applied);
    state.put("fallback", fallback);
    latest.ifPresent(
        frame -> {
          state.put("body", frame.body().toString());
          state.put("life", frame.life());
          state.put("tick", frame.input().snapshot().tick());
          state.put("elapsed", frame.input().snapshot().tick() - started);
          state.put("hp", frame.input().self().health());
          if (result.equals("live"))
            frame.observation().ifPresent(sample -> state.put("observation", sample.values()));
        });
    PROTOCOL.validate(state);
    return Map.copyOf(state);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeDamage(EntityDamageByEntityEvent event) {
    if (!result.equals("live")) return;
    var actors =
        storm().service(MatchView.class).current().map(MatchState::of).orElseThrow().combatants();
    if (actors.stream().noneMatch(f -> f.uuid().equals(event.getDamager().getUniqueId()))
        || actors.stream().noneMatch(f -> f.uuid().equals(event.getEntity().getUniqueId()))) return;
    if (event.getEntity() instanceof Player player) healthBefore.put(event, player.getHealth());
  }

  /** RWF cancels vanilla damage and applies its own health change during HIGH. */
  @EventHandler(priority = EventPriority.MONITOR)
  public void damaged(EntityDamageByEntityEvent event) {
    var before = healthBefore.remove(event);
    if (before == null || !(event.getEntity() instanceof Player player)) return;
    var lost = Math.max(0, before - player.getHealth());
    if (candidate.filter(event.getDamager().getUniqueId()::equals).isPresent()) dealt += lost;
    else received += lost;
  }
}
