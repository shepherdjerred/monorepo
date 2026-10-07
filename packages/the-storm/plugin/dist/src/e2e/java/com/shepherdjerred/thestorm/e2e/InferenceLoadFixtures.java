package com.shepherdjerred.thestorm.e2e;

import com.destroystokyo.paper.event.server.ServerTickEndEvent;
import com.destroystokyo.paper.event.server.ServerTickStartEvent;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.ShowcaseControl;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.DiagnosticInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatCommands;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/**
 * Real bodies, authored team decisions, native damage and batched Java sword actions. Test jar
 * only.
 */
final class InferenceLoadFixtures implements BasicCommand, CombatHarness.Controller, Listener {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final InferenceLoadProtocol PROTOCOL =
      InferenceLoadProtocol.load(TickSample.class);
  private final JavaPlugin plugin;
  private Optional<CompletableFuture<BatchedInference>> loading = Optional.empty();
  private Optional<BatchedInference> inference = Optional.empty();
  private Optional<MatchEvents.Subscription> subscription = Optional.empty();
  private Optional<UUID> match = Optional.empty();
  private final Set<UUID> bodies = new HashSet<>();
  private final List<InferenceRequest> requests = new ArrayList<>();
  private final List<TickSample> samples = new ArrayList<>();
  private final long[] ages = new long[3];
  private final java.util.IdentityHashMap<EntityDamageByEntityEvent, Double> healthBefore =
      new java.util.IdentityHashMap<>();
  private boolean collecting;
  private String result = "idle";
  private long seed;
  private int bots;
  private long botTick;
  private OptionalLong clockOffset = OptionalLong.empty();
  private int alive;
  private int observed;
  private int applied;
  private int unavailable;
  private int ineligible;
  private boolean liveTick;
  private long damageEvents;
  private double damage;

  private record TickSample(
      int serverTick,
      double milliseconds,
      String match,
      long botTick,
      int alive,
      int observed,
      int applied,
      int unavailable,
      int ineligible,
      boolean live) {}

  InferenceLoadFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("rwfinferload", this));
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
          .sendMessage(Component.text("rwfinferload requires the disposable server console"));
      return;
    }
    try {
      command(args);
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(sample())));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void command(String[] args) {
    if (args.length == 0)
      throw new IllegalArgumentException(
          "load, sample, begin <bots> <seed>, cancel, window <start|stop>");
    switch (args[0]) {
      case "load" -> {
        if (args.length != 1 || loading.isPresent())
          throw new IllegalArgumentException("load once per server");
        loading = Optional.of(storm().service(DiagnosticInference.class).load());
      }
      case "sample" -> {
        requireLength(args, 1);
      }
      case "begin" -> {
        requireLength(args, 3);
        begin(Integer.parseInt(args[1]), Long.parseLong(args[2]));
      }
      case "cancel" -> {
        requireLength(args, 1);
        cancel();
      }
      case "window" -> window(args);
      default -> throw new IllegalArgumentException("unknown rwfinferload command");
    }
  }

  private static void requireLength(String[] args, int length) {
    if (args.length != length) throw new IllegalArgumentException("wrong argument count");
  }

  private void window(String[] args) {
    requireLength(args, 2);
    if (!List.of("start", "stop").contains(args[1]))
      throw new IllegalArgumentException("window needs start or stop");
    if (args[1].equals("start") && collecting)
      throw new IllegalStateException("window already started");
    collecting = args[1].equals("start");
  }

  private Map<String, Object> sample() {
    if (inference.isEmpty() && loading.isPresent() && loading.orElseThrow().isDone()) {
      var model = loading.orElseThrow().getNow(null);
      if (model == null) throw new IllegalStateException("missing loaded Java actor");
      inference = Optional.of(model);
    }
    var fields = new LinkedHashMap<String, Object>();
    fields.put("protocol", PROTOCOL.version());
    fields.put("contract", PROTOCOL.contract());
    fields.put("ready", inference.isPresent());
    fields.put("result", result);
    fields.put("phase", current().phase().name());
    fields.put("match", match.map(UUID::toString).orElse(""));
    fields.put("seed", seed);
    fields.put("bots", bots);
    fields.put("ticks", List.copyOf(samples));
    fields.put("ages", ages.clone());
    fields.put("damageEvents", damageEvents);
    fields.put("damage", damage);
    inference.ifPresent(model -> fields.put("inference", model.metrics()));
    PROTOCOL.validate(fields);
    samples.clear();
    return fields;
  }

  private MatchState current() {
    return storm().service(MatchView.class).current().map(MatchState::of).orElseThrow();
  }

  private void begin(int count, long nextSeed) {
    if (!List.of(20, 50, 100).contains(count) || nextSeed < 0 || nextSeed > 1_000_000_000)
      throw new IllegalArgumentException("begin needs 20, 50 or 100 bots and a bounded seed");
    var model = inference.orElseThrow(() -> new IllegalStateException("model not ready"));
    var lobby = current();
    if (lobby.phase() != MatchState.Phase.LOBBY
        || !lobby.combatants().isEmpty()
        || !lobby.mapId().orElseThrow().equals("training-yard"))
      throw new IllegalStateException("need an empty training-yard lobby");
    cancel();
    seed = nextSeed;
    bots = count;
    bodies.clear();
    model.reset(new SplittableRandom(seed));
    storm().service(CombatHarness.class).attach(seed, count, this);
    match = Optional.of(lobby.matchId());
    result = "waiting";
    subscription =
        Optional.of(
            storm()
                .service(MatchEvents.class)
                .subscribe(notification -> changed(MatchState.of(notification.after()))));
    var refusal = storm().service(ShowcaseControl.class).start(count);
    if (refusal.isPresent()) {
      cancel();
      throw new IllegalStateException(refusal.orElseThrow());
    }
  }

  private void changed(MatchState state) {
    if (match.filter(state.matchId()::equals).isEmpty()) return;
    if (state.phase() == MatchState.Phase.LIVE && result.equals("waiting")) {
      if (state.combatants().size() != bots
          || state.combatants().stream().anyMatch(f -> !f.bot() || !f.alive()))
        throw new IllegalStateException("native load roster differs");
      state.combatants().forEach(fighter -> bodies.add(fighter.uuid()));
      result = "live";
    } else if (state.phase() == MatchState.Phase.ENDED) result = "ended";
    else if (state.phase() == MatchState.Phase.RESETTING && result.equals("live"))
      result = "stopped";
  }

  private void cancel() {
    subscription.ifPresent(MatchEvents.Subscription::close);
    subscription = Optional.empty();
    match.ifPresent(id -> storm().service(ShowcaseControl.class).stop(id));
    if (match.isPresent()) storm().service(CombatHarness.class).detach();
    match = Optional.empty();
    bodies.clear();
    result = "cancelled";
  }

  @EventHandler
  public void tickStart(ServerTickStartEvent event) {
    alive = 0;
    observed = 0;
    applied = 0;
    unavailable = 0;
    ineligible = 0;
    liveTick = false;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void tickEnd(ServerTickEndEvent event) {
    // Keep observing completed jobs across normal deaths/end screens. The
    // fixture's server clock is mapped once to BotTicker's monotonic clock;
    // otherwise an already-finished job would look late at the next match.
    if (!liveTick && clockOffset.isPresent())
      inference
          .orElseThrow()
          .tick(plugin.getServer().getCurrentTick() - clockOffset.orElseThrow(), List.of());
    if (!collecting) return;
    if (samples.size() >= 2000)
      throw new IllegalStateException("load sampler was not drained within 100 seconds");
    samples.add(
        new TickSample(
            event.getTickNumber(),
            event.getTickDuration(),
            match.map(UUID::toString).orElse(""),
            botTick,
            alive,
            observed,
            applied,
            unavailable,
            ineligible,
            liveTick));
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeDamage(EntityDamageByEntityEvent event) {
    var attacker = event.getDamager();
    if (attacker instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) attacker = shooter;
    if (bodies.contains(attacker.getUniqueId())
        && bodies.contains(event.getEntity().getUniqueId())
        && event.getEntity() instanceof Player player) healthBefore.put(event, player.getHealth());
  }

  /** RWF applies health changes during HIGH and cancels vanilla damage. */
  @EventHandler(priority = EventPriority.MONITOR)
  public void damage(EntityDamageByEntityEvent event) {
    var before = healthBefore.remove(event);
    if (before == null || !(event.getEntity() instanceof Player player)) return;
    var lost = Math.max(0, before - player.getHealth());
    if (lost > 0) {
      damageEvents++;
      damage += lost;
    }
  }

  @Override
  public ReflexInput input(ReflexInput authored, NavArtifact nav) {
    return authored;
  }

  @Override
  public void captureTick(long tick) {
    var offset = plugin.getServer().getCurrentTick() - tick;
    if (clockOffset.isPresent() && clockOffset.orElseThrow() != offset)
      throw new IllegalStateException("native load clock alignment changed");
    clockOffset = OptionalLong.of(offset);
    requests.clear();
    botTick = tick;
    liveTick = true;
    alive = (int) current().combatants().stream().filter(MatchState.Fighter::alive).count();
  }

  @Override
  public void finishTick(long tick) {
    inference.orElseThrow().tick(tick, List.copyOf(requests));
  }

  @Override
  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    if (!bodies.contains(frame.body()) || !frame.matchId().equals(match.orElseThrow()))
      throw new IllegalStateException("foreign native load body");
    var observation =
        frame
            .observation()
            .orElseThrow(
                () -> new IllegalStateException("living load body lacks fair observation"));
    var request =
        new InferenceRequest(
            new InferenceRequest.Identity(
                frame.matchId(), frame.body(), frame.life(), frame.input().self().kit()),
            frame.input().snapshot().tick(),
            frame.input().self().yaw(),
            observation.values());
    requests.add(request);
    observed++;
    var action = inference.orElseThrow().action(request);
    if (!CombatCommands.eligible(frame.authored().commands(), frame.input())) {
      ineligible++;
      return frame.authored().commands();
    }
    if (action.isEmpty()) {
      unavailable++;
      return frame.authored().commands();
    }
    var ticket = action.orElseThrow();
    var age = Math.toIntExact(request.tick() - ticket.tick());
    if (age < 0 || age > 2) throw new IllegalStateException("late action reached native driver");
    ages[age]++;
    applied++;
    return CombatCommands.replace(frame.authored().commands(), frame.input(), ticket);
  }
}
