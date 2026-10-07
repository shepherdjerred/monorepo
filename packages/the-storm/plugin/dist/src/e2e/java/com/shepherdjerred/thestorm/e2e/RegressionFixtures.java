package com.shepherdjerred.thestorm.e2e;

import com.destroystokyo.paper.event.server.ServerTickEndEvent;
import com.destroystokyo.paper.event.server.ServerTickStartEvent;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionContract;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.DiagnosticInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.InferenceRequest;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatCommands;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ObservationContract;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.IdentityHashMap;
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
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.json.JsonMapper;

/** Authored gameplay plus exact Java Trooper selections; console-only, disposable fixture jar. */
final class RegressionFixtures implements BasicCommand, CombatHarness.Controller, Listener {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final RegressionProtocol PROTOCOL =
      RegressionProtocol.load(
          Map.of(
              "Action", Action.class,
              "Tick", Tick.class,
              "Damage", Damage.class,
              "Transition", Transition.class,
              "Fighter", Fighter.class));
  private final JavaPlugin plugin;
  private Optional<CompletableFuture<BatchedInference>> loading = Optional.empty();
  private Optional<BatchedInference> inference = Optional.empty();
  private Optional<MatchEvents.Subscription> subscription = Optional.empty();
  private Optional<UUID> match = Optional.empty();
  private OptionalLong clockOffset = OptionalLong.empty();
  private final List<InferenceRequest> requests = new ArrayList<>();
  private final Set<String> usedCases = new HashSet<>();
  private final Set<UUID> members = new HashSet<>();
  private final List<Action> actions = new ArrayList<>();
  private final List<Tick> ticks = new ArrayList<>();
  private final List<Damage> damage = new ArrayList<>();
  private final List<Transition> transitions = new ArrayList<>();
  private final IdentityHashMap<EntityDamageByEntityEvent, Double> healthBefore =
      new IdentityHashMap<>();
  private String caseName = "";
  private String result = "idle";
  private long sequence;
  private long botTick;
  private boolean liveTick;
  private boolean inferenceTicked;
  private int batchRows;

  private record Action(
      long sequence,
      int serverTick,
      long botTick,
      UUID match,
      UUID body,
      int life,
      String kit,
      String decision,
      int heldSlot,
      boolean usingItem,
      @Nullable Integer targetId,
      double x,
      double y,
      double z,
      double health,
      double absorption,
      List<String> authored,
      List<String> commands,
      @Nullable ActionTicket ticket) {}

  private record Tick(
      long sequence,
      int serverTick,
      long botTick,
      double milliseconds,
      boolean live,
      int batchRows) {}

  private record Damage(
      long sequence,
      int serverTick,
      UUID attacker,
      UUID victim,
      String cause,
      boolean cancelled,
      double before,
      double after,
      double velocityX,
      double velocityY,
      double velocityZ) {}

  private record Fighter(
      UUID body, boolean bot, String personality, String team, String kit, boolean alive) {}

  private record Transition(
      long sequence,
      int serverTick,
      UUID match,
      String event,
      String phase,
      String winner,
      List<Fighter> fighters) {}

  RegressionFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("rwfinferregression", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  private TheStormPlugin storm() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm;
  }

  private MatchState current() {
    return storm().service(MatchView.class).current().map(MatchState::of).orElseThrow();
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source
          .getSender()
          .sendMessage(Component.text("regression capture requires the test console"));
      return;
    }
    try {
      command(args);
      var state = sample();
      var encoded = JSON.writeValueAsString(state);
      source.getSender().sendMessage(Component.text(encoded));
      actions.clear();
      ticks.clear();
      damage.clear();
      transitions.clear();
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void command(String[] args) {
    if (args.length == 1 && args[0].equals("load")) {
      if (loading.isPresent()) throw new IllegalStateException("load once per server");
      loading = Optional.of(storm().service(DiagnosticInference.class).load());
    } else if (args.length == 1 && args[0].equals("sample")) {
      // Sampling drains the original journal only after it has been encoded successfully.
    } else if (args.length == 3 && args[0].equals("arm")) {
      arm(args[1], Integer.parseInt(args[2]));
    } else if (args.length == 1 && args[0].equals("release")) {
      release();
    } else {
      throw new IllegalArgumentException("load, sample, arm <case> <bot-slots>, release");
    }
  }

  private Map<String, Object> sample() {
    if (inference.isEmpty() && loading.isPresent() && loading.orElseThrow().isDone()) {
      var model = loading.orElseThrow().getNow(null);
      if (model == null) throw new IllegalStateException("loaded regression actor missing");
      inference = Optional.of(model);
    }
    var state = new LinkedHashMap<String, Object>();
    state.put("protocol", PROTOCOL.version());
    state.put("contract", PROTOCOL.contract());
    state.put("ready", inference.isPresent());
    state.put("caseName", caseName);
    state.put("match", match.map(UUID::toString).orElse(""));
    state.put("result", result);
    state.put("phase", current().phase().name());
    state.put("sequence", sequence);
    state.put("actions", List.copyOf(actions));
    state.put("ticks", List.copyOf(ticks));
    state.put("damage", List.copyOf(damage));
    state.put("transitions", List.copyOf(transitions));
    state.put("inference", inference.map(BatchedInference::metrics).orElse(null));
    PROTOCOL.validate(state);
    return state;
  }

  private void arm(String name, int slots) {
    if (!PromotionContract.VALUES.regressionCases().contains(name) || usedCases.contains(name))
      throw new IllegalArgumentException("need a required case not previously armed");
    if (slots < 1 || slots > 100) throw new IllegalArgumentException("bot slots need 1..100");
    if (subscription.isPresent()) throw new IllegalStateException("release the previous case");
    var model = inference.orElseThrow(() -> new IllegalStateException("actor not ready"));
    var lobby = current();
    if (lobby.phase() != MatchState.Phase.LOBBY
        || !lobby.combatants().isEmpty()
        || !lobby.mapId().orElseThrow().equals("training-yard"))
      throw new IllegalStateException("need an empty training-yard lobby");
    if (!actions.isEmpty() || !ticks.isEmpty() || !damage.isEmpty() || !transitions.isEmpty())
      throw new IllegalStateException("previous journal must be drained before arming");
    storm().service(CombatHarness.class).attachAuthored(slots, this);
    model.reset(
        new SplittableRandom(
            lobby.matchId().getMostSignificantBits() ^ lobby.matchId().getLeastSignificantBits()));
    caseName = name;
    sequence = 0;
    requests.clear();
    match = Optional.of(lobby.matchId());
    members.clear();
    usedCases.add(name);
    result = "armed";
    subscription = Optional.of(storm().service(MatchEvents.class).subscribe(this::changed));
  }

  private void release() {
    if (subscription.isEmpty()) throw new IllegalStateException("no armed regression case");
    if (!List.of("ended", "stopped").contains(result))
      throw new IllegalStateException("the original case has not ended");
    var metrics = inference.orElseThrow().metrics();
    if (metrics.submitted() != metrics.deadlineMet() + metrics.deadlineMissed())
      throw new IllegalStateException("pending inference must drain before release");
    subscription.orElseThrow().close();
    subscription = Optional.empty();
    storm().service(CombatHarness.class).detach();
    result = "released";
  }

  private long next() {
    if (actions.size() + ticks.size() + damage.size() + transitions.size()
        >= PROTOCOL.maximumRows())
      throw new IllegalStateException("regression journal was not drained before its bound");
    return ++sequence;
  }

  private void changed(MatchNotification notification) {
    var state = MatchState.of(notification.after());
    if (match.filter(state.matchId()::equals).isEmpty()) return;
    state.combatants().forEach(fighter -> members.add(fighter.uuid()));
    transitions.add(
        new Transition(
            next(),
            plugin.getServer().getCurrentTick(),
            state.matchId(),
            notification.event().getClass().getSimpleName(),
            state.phase().name(),
            state.winner().orElse(""),
            state.combatants().stream()
                .map(
                    f ->
                        new Fighter(
                            f.uuid(),
                            f.bot(),
                            f.personalityId().orElse(""),
                            f.team().orElse(""),
                            f.kit().orElse(""),
                            f.alive()))
                .toList()));
    if (state.phase() == MatchState.Phase.LIVE) result = "live";
    else if (state.phase() == MatchState.Phase.ENDED) result = "ended";
    else if (state.phase() == MatchState.Phase.RESETTING && result.equals("live"))
      result = "stopped";
  }

  @EventHandler
  public void tickStart(ServerTickStartEvent event) {
    liveTick = false;
    inferenceTicked = false;
    batchRows = 0;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void tickEnd(ServerTickEndEvent event) {
    if (!inferenceTicked && clockOffset.isPresent()) {
      botTick = plugin.getServer().getCurrentTick() - clockOffset.orElseThrow();
      inference.orElseThrow().tick(botTick, List.of());
    }
    if (subscription.isPresent())
      ticks.add(
          new Tick(
              next(),
              plugin.getServer().getCurrentTick(),
              botTick,
              event.getTickDuration(),
              liveTick,
              batchRows));
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeDamage(EntityDamageByEntityEvent event) {
    if (subscription.isEmpty()) return;
    var attacker = attacker(event);
    if ((members.contains(attacker) || members.contains(event.getEntity().getUniqueId()))
        && event.getEntity() instanceof Player victim)
      healthBefore.put(event, victim.getHealth() + victim.getAbsorptionAmount());
  }

  private static UUID attacker(EntityDamageByEntityEvent event) {
    if (event.getDamager() instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) return shooter.getUniqueId();
    return event.getDamager().getUniqueId();
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void afterDamage(EntityDamageByEntityEvent event) {
    var before = healthBefore.remove(event);
    if (before == null || !(event.getEntity() instanceof Player victim)) return;
    var velocity = victim.getVelocity();
    damage.add(
        new Damage(
            next(),
            plugin.getServer().getCurrentTick(),
            attacker(event),
            victim.getUniqueId(),
            event.getCause().name(),
            event.isCancelled(),
            before,
            victim.getHealth() + victim.getAbsorptionAmount(),
            velocity.getX(),
            velocity.getY(),
            velocity.getZ()));
  }

  @Override
  public void captureTick(long tick) {
    var offset = plugin.getServer().getCurrentTick() - tick;
    if (clockOffset.isPresent() && clockOffset.orElseThrow() != offset)
      throw new IllegalStateException("regression capture clock alignment changed");
    clockOffset = OptionalLong.of(offset);
    requests.clear();
    botTick = tick;
    liveTick = true;
  }

  @Override
  public void finishTick(long tick) {
    if (tick != botTick || inferenceTicked)
      throw new IllegalStateException("regression capture inference tick differs");
    batchRows = requests.size();
    inference.orElseThrow().tick(tick, List.copyOf(requests));
    inferenceTicked = true;
  }

  @Override
  public ReflexInput input(ReflexInput authored, NavArtifact nav) {
    throw new IllegalStateException("authored regression inputs cannot be overridden");
  }

  @Override
  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    if (!members.contains(frame.body()) || !frame.matchId().equals(match.orElseThrow()))
      throw new IllegalStateException("foreign regression body or match");
    var chosen = frame.authored().commands();
    var decision = "authored-kit";
    ActionTicket ticket = null;
    if (frame.input().self().kit() == Kit.TROOPER) {
      var observation =
          frame
              .observation()
              .orElseThrow(
                  () ->
                      new IllegalStateException(
                          "living regression Trooper lacks fair observation"));
      if (!observation.contract().equals(ObservationContract.ID))
        throw new IllegalArgumentException("regression observation contract differs");
      var request =
          new InferenceRequest(
              new InferenceRequest.Identity(
                  frame.matchId(), frame.body(), frame.life(), Kit.TROOPER),
              frame.input().snapshot().tick(),
              frame.input().self().yaw(),
              observation.values());
      requests.add(request);
      var action = inference.orElseThrow().action(request);
      if (!CombatCommands.eligible(chosen, frame.input())) decision = "ineligible";
      else if (action.isEmpty()) decision = "unavailable";
      else {
        ticket = action.orElseThrow();
        if (!ticket.applies(frame.matchId(), frame.body(), frame.life(), request.tick()))
          throw new IllegalStateException("foreign or late regression action reached the driver");
        chosen = CombatCommands.replace(chosen, frame.input(), ticket);
        decision = "applied";
      }
    }
    if (!PROTOCOL.decisions().contains(decision))
      throw new IllegalStateException("regression decision differs from contract");
    var self = frame.input().self();
    actions.add(
        new Action(
            next(),
            plugin.getServer().getCurrentTick(),
            botTick,
            frame.matchId(),
            frame.body(),
            frame.life(),
            self.kit().name(),
            decision,
            self.heldSlot(),
            self.usingItem(),
            frame.input().target().map(target -> target.id().value()).orElse(null),
            self.pos().x(),
            self.pos().y(),
            self.pos().z(),
            self.health(),
            self.absorption(),
            frame.authored().commands().stream().map(Object::toString).toList(),
            chosen.stream().map(Object::toString).toList(),
            ticket));
    return chosen;
  }
}
