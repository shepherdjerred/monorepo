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
  private final CaptureMarkers capture;
  private Optional<MatchEvents.Subscription> subscription = Optional.empty();
  private Optional<UUID> match = Optional.empty();
  private Optional<UUID> candidate = Optional.empty();
  private DuelActor primary = new DuelActor();
  private DuelActor historical = new DuelActor();
  private final java.util.IdentityHashMap<EntityDamageByEntityEvent, Double> healthBefore =
      new java.util.IdentityHashMap<>();
  private final Map<CombatantId, Vec3> seen = new java.util.HashMap<>();
  private final Map<CombatantId, Decision> pursuit = new java.util.HashMap<>();
  private String side = "red";
  private String mode = "authored";
  private String opponent = "basic";
  private long seed;
  private long started;
  private double dealt;
  private double received;
  private double sampledDealt;
  private double sampledReceived;
  private long sampleTick;
  private String result = "waiting";
  private Optional<com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference> inference =
      Optional.empty();
  private final List<com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest>
      inferenceRequests = new ArrayList<>();

  DuelFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
    capture = new CaptureMarkers(plugin);
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("rwflearn", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
    new InferenceFixtures(plugin, this).register();
    capture.register();
  }

  void inference(com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference model) {
    if (result.equals("live")) throw new IllegalStateException("cannot replace a live duel model");
    inference.ifPresent(com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference::close);
    inference = Optional.of(model);
  }

  void beginJava(long seed, String side, String opponent) {
    if (inference.isEmpty()) throw new IllegalStateException("Java diagnostic model is not loaded");
    if (!List.of("authored", "basic").contains(opponent))
      throw new IllegalArgumentException("Java evaluation opponent must be authored or basic");
    begin(new String[] {"begin", Long.toString(seed), side, "external", opponent});
    inference.orElseThrow().reset(new java.util.SplittableRandom(seed));
  }

  Object inferenceMetrics() {
    return Map.of(
        "inference",
            inference
                .orElseThrow(() -> new IllegalStateException("Java model not loaded"))
                .metrics(),
        "delivery", primary.delivery());
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
        case "acts" -> submitPair(args);
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
    if (nextOpponent.equals("historical") && !args[3].equals("external"))
      throw new IllegalArgumentException("historical opponent requires external mode");
    var current = storm().service(MatchView.class).current().map(MatchState::of).orElseThrow();
    if (current.phase() != MatchState.Phase.LOBBY
        || !current.combatants().isEmpty()
        || !current.mapId().orElseThrow().equals("training-yard"))
      throw new IllegalStateException("need an empty training-yard lobby");
    capture.requireReady(nextSeed);
    cancel();
    side = args[2];
    mode = args[3];
    opponent = nextOpponent;
    seed = nextSeed;
    candidate = Optional.empty();
    primary = new DuelActor();
    historical = new DuelActor();
    seen.clear();
    pursuit.clear();
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
    capture.begin(current.matchId(), seed, side, mode, opponent);
    var refusal = storm().service(ShowcaseControl.class).startSeeded(current.matchId(), 2, seed);
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
      capture.terminal(result);
      clearActions();
    } else if (current.phase() == MatchState.Phase.RESETTING && result.equals("live")) {
      result = "stopped";
      capture.terminal(result);
      clearActions();
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
    capture.terminal("cancelled");
    subscription.ifPresent(MatchEvents.Subscription::close);
    subscription = Optional.empty();
    match.ifPresent(id -> storm().service(ShowcaseControl.class).stop(id));
    storm().service(CombatHarness.class).detach();
    match = Optional.empty();
    clearActions();
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
        self.team().value().equals(side)
                || opponent.startsWith("authored")
                || opponent.equals("historical")
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
    if (result.equals("live")) capture.tick(tick);
    inferenceRequests.clear();
    sampleTick = tick;
    sampledDealt = dealt;
    sampledReceived = received;
  }

  @Override
  public void finishTick(long tick) {
    if (result.equals("live"))
      inference.ifPresent(model -> model.tick(tick, List.copyOf(inferenceRequests)));
  }

  @Override
  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    if (!result.equals("live")) return List.of(new BodyCommand.Stop());
    if (started == 0) started = frame.input().snapshot().tick();
    if (frame.input().snapshot().tick() - started >= 1200) {
      result = "timeout";
      capture.terminal(result);
      storm().service(ShowcaseControl.class).stop(frame.matchId());
      return List.of();
    }
    if (!candidate.filter(frame.body()::equals).isPresent()) {
      if (opponent.equals("historical")) return historical.commands(frame, true);
      return opponent.startsWith("authored") ? authored(frame) : basic(frame);
    }
    var request = javaRequest(frame);
    if (inference.isPresent() && request.isPresent() && mode.equals("external")) {
      var context = request.orElseThrow();
      inferenceRequests.add(context);
      return primary.commands(frame, true, inference.orElseThrow().action(context));
    }
    return primary.commands(frame, mode.equals("external"));
  }

  private Optional<com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest> javaRequest(
      CombatHarness.Frame frame) {
    return frame
        .observation()
        .map(
            observation ->
                new com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest(
                    new com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest.Identity(
                        frame.matchId(), frame.body(), frame.life(), frame.input().self().kit()),
                    frame.input().snapshot().tick(),
                    frame.input().self().yaw(),
                    observation.values()));
  }

  /** Frozen movement variants retain authored aim, click timing, healing and item use. */
  private List<BodyCommand> authored(CombatHarness.Frame frame) {
    var commands = frame.authored().commands();
    if (opponent.equals("authored")
        || !CombatCommands.eligible(commands, frame.input())
        || frame.input().target().isEmpty()) return commands;
    return commands.stream()
        .map(
            command -> {
              if (!(command instanceof BodyCommand.MoveToward movement)) return command;
              return (BodyCommand) styledMovement(frame, movement);
            })
        .toList();
  }

  private BodyCommand.MoveToward styledMovement(
      CombatHarness.Frame frame, BodyCommand.MoveToward movement) {
    var self = frame.input().self();
    var toward = frame.input().target().orElseThrow().pos().minus(self.pos()).horizontal();
    var radial = toward.normalized();
    var sideways = new Vec3(-radial.z(), 0, radial.x());
    var lateral = movement.waypoint().minus(self.pos()).horizontal().dot(sideways) < 0 ? -0.5 : 0.5;
    var closing = styleClosing(toward.length());
    var move = radial.scale(closing).plus(sideways.scale(lateral)).normalized();
    return new BodyCommand.MoveToward(self.pos().plus(move), movement.sprint() && closing > 0);
  }

  private double styleClosing(double distance) {
    if (opponent.equals("authored-pressure")) return distance > 2.5 ? 1.0 : 0.0;
    return distance > 3.0 ? 1.0 : distance < 2.7 ? -1.0 : 0.0;
  }

  private void clearActions() {
    primary.clearAction();
    historical.clearAction();
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
    if (inference.isPresent())
      throw new IllegalArgumentException("Java model owns this duel's controls");
    if (args.length != 10 || !mode.equals("external"))
      throw new IllegalArgumentException("act requires an external live duel and nine fields");
    requireLive();
    var request = request(args, 1);
    request.actor().accept(request.ticket());
  }

  private void submitPair(String[] args) {
    if (args.length != 19 || !opponent.equals("historical"))
      throw new IllegalArgumentException("acts requires two historical live contexts");
    requireLive();
    // Validate both before changing either body; a rejected batch has no partial action.
    var first = request(args, 1);
    var second = request(args, 10);
    if (first.actor() == second.actor() || first.ticket().tick() != second.ticket().tick())
      throw new IllegalArgumentException("acts requires distinct bodies on the same tick");
    first.actor().accept(first.ticket());
    second.actor().accept(second.ticket());
  }

  private record Request(DuelActor actor, ActionTicket ticket) {}

  private void requireLive() {
    if (!result.equals("live")) throw new IllegalArgumentException("duel no longer live");
  }

  private Request request(String[] args, int offset) {
    var body = UUID.fromString(args[offset + 1]);
    var actor =
        candidate.filter(body::equals).isPresent()
            ? primary
            : historical
                .latest()
                .filter(frame -> frame.body().equals(body))
                .map(frame -> historical)
                .orElseThrow(
                    () -> new IllegalArgumentException("stale, duplicate or wrong-context action"));
    var tick = Long.parseLong(args[offset + 3]);
    var frame = actor.context(tick);
    var ticket =
        new ActionTicket(
            UUID.fromString(args[offset]),
            body,
            Integer.parseInt(args[offset + 2]),
            tick,
            frame.input().self().yaw(),
            new CombatAction(
                Integer.parseInt(args[offset + 4]),
                bit(args[offset + 5]),
                bit(args[offset + 6]),
                bit(args[offset + 7]),
                bit(args[offset + 8])));
    actor.validate(ticket);
    return new Request(actor, ticket);
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
    state.put("result", result.equals("live") && primary.latest().isEmpty() ? "waiting" : result);
    state.put("phase", current.phase().name());
    state.put("match", match.map(UUID::toString).orElse(""));
    state.put("dealt", dealt);
    state.put("received", received);
    state.put("sampleDealt", result.equals("live") ? sampledDealt : dealt);
    state.put("sampleReceived", result.equals("live") ? sampledReceived : received);
    state.put("sampleTick", sampleTick);
    state.putAll(primary.fields(result.equals("live")));
    if (opponent.equals("historical") && historical.latest().isPresent())
      state.put("opponentFrame", historical.fields(result.equals("live")));
    primary
        .latest()
        .ifPresent(
            frame -> {
              state.put("elapsed", frame.input().snapshot().tick() - started);
              state.put("hp", frame.input().self().health());
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
