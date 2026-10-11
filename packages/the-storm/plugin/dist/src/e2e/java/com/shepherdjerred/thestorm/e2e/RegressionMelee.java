package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Atomic native melee trials on the original regression roster; disposable console only. */
final class RegressionMelee implements BasicCommand {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .build();
  private static final Spec SPEC = load();
  private final JavaPlugin plugin;
  private final Supplier<MatchState> context;
  private Optional<Pair> pair = Optional.empty();
  private int attempt;

  private record Spec(
      int version,
      String contract,
      List<String> trials,
      String world,
      double reach,
      List<Double> attacker,
      List<Double> victim,
      List<List<Integer>> wall,
      List<String> fields,
      List<String> bodyFields) {}

  private record Pair(UUID attacker, UUID victim) {}

  private record Body(
      UUID body,
      double x,
      double y,
      double z,
      float yaw,
      float pitch,
      double health,
      double absorption,
      double velocityX,
      double velocityY,
      double velocityZ,
      int heldSlot,
      String weapon,
      int knockbackLevel,
      boolean sprinting,
      String gameMode,
      boolean invulnerable) {}

  private record Probe(
      int protocol,
      String contract,
      UUID match,
      String phase,
      String world,
      int serverTick,
      String trial,
      Body attackerBefore,
      Body victimBefore,
      Body attackerAfter,
      Body victimAfter,
      boolean reachable,
      boolean visible,
      List<String> wallBefore,
      List<String> wallDuring,
      List<String> wallAfter,
      String refusal) {}

  RegressionMelee(JavaPlugin plugin, Supplier<MatchState> context) {
    this.plugin = plugin;
    this.context = context;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("rwfmeleeregression", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source.getSender().sendMessage(Component.text("melee regression requires the test console"));
      return;
    }
    try {
      if (args.length != 3
          || attempt >= SPEC.trials().size()
          || !args[0].equals(SPEC.trials().get(attempt)))
        throw new IllegalArgumentException("one original blocked trial, then one clear trial");
      var original = context.get();
      var requested = new Pair(UUID.fromString(args[1]), UUID.fromString(args[2]));
      validate(original, requested);
      if (pair.isPresent() && !pair.orElseThrow().equals(requested))
        throw new IllegalStateException("original melee identities changed");
      pair = Optional.of(requested);
      attempt++;
      var result = trial(original, args[0], requested);
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(result)));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private static void validate(MatchState state, Pair pair) {
    var attacker = state.combatant(pair.attacker()).orElseThrow();
    var victim = state.combatant(pair.victim()).orElseThrow();
    if (state.phase() != MatchState.Phase.LIVE
        || state.combatants().size() != 16
        || state.combatants().stream().anyMatch(fighter -> !fighter.bot())
        || !attacker.alive()
        || !victim.alive()
        || attacker.team().equals(victim.team())
        || !attacker.kit().filter("trooper"::equals).isPresent()
        || !victim.kit().filter("trooper"::equals).isPresent())
      throw new IllegalStateException("melee trials need original living opposing Troopers");
  }

  private Probe trial(MatchState state, String trial, Pair pair) {
    var attacker = player(pair.attacker());
    var victim = player(pair.victim());
    var world = attacker.getWorld();
    if (!world.getName().equals(SPEC.world()) || !world.equals(victim.getWorld()))
      throw new IllegalStateException("original melee world changed");
    place(attacker, SPEC.attacker());
    place(victim, SPEC.victim());
    var beforeWall = wall(world);
    if (!beforeWall.equals(List.of("minecraft:air", "minecraft:air")))
      throw new IllegalStateException("original melee test cells are not air");
    List<String> duringWall;
    Body beforeAttacker;
    Body beforeVictim;
    Body afterAttacker;
    Body afterVictim;
    boolean reachable;
    boolean visible;
    String refusal;
    try {
      if (trial.equals("blocked")) wall(world, Material.STONE);
      duringWall = wall(world);
      beforeAttacker = body(attacker);
      beforeVictim = body(victim);
      var eye = attacker.getEyeLocation();
      reachable =
          victim.getBoundingBox().rayTrace(eye.toVector(), eye.getDirection(), SPEC.reach())
              != null;
      visible = attacker.hasLineOfSight(victim);
      var actions =
          BotActions.over(
              storm().service(CombatantActions.class), storm().service(MatchView.class));
      refusal = actions.melee(pair.attacker(), pair.victim()).map(Enum::name).orElse("");
      afterAttacker = body(attacker);
      afterVictim = body(victim);
    } finally {
      wall(world, Material.AIR);
    }
    return new Probe(
        SPEC.version(),
        SPEC.contract(),
        state.matchId(),
        state.phase().name(),
        world.getName(),
        plugin.getServer().getCurrentTick(),
        trial,
        beforeAttacker,
        beforeVictim,
        afterAttacker,
        afterVictim,
        reachable,
        visible,
        beforeWall,
        duringWall,
        wall(world),
        refusal);
  }

  private static void place(Player player, List<Double> point) {
    if (!player.teleport(
        new Location(
            player.getWorld(),
            point.get(0),
            point.get(1),
            point.get(2),
            point.get(3).floatValue(),
            point.get(4).floatValue())))
      throw new IllegalStateException("native melee pose refused");
    player.setVelocity(new Vector());
    player.getInventory().setHeldItemSlot(1);
  }

  private static List<String> wall(World world) {
    return SPEC.wall().stream()
        .map(
            point ->
                world
                    .getBlockAt(point.get(0), point.get(1), point.get(2))
                    .getBlockData()
                    .getAsString())
        .toList();
  }

  private static void wall(World world, Material material) {
    SPEC.wall()
        .forEach(
            point ->
                world
                    .getBlockAt(point.get(0), point.get(1), point.get(2))
                    .setType(material, false));
  }

  private static Body body(Player player) {
    var at = player.getLocation();
    var velocity = player.getVelocity();
    var weapon = player.getInventory().getItemInMainHand();
    var knockback =
        Objects.requireNonNull(
            RegistryAccess.registryAccess()
                .getRegistry(RegistryKey.ENCHANTMENT)
                .get(Key.key("minecraft:knockback")));
    return new Body(
        player.getUniqueId(),
        at.getX(),
        at.getY(),
        at.getZ(),
        at.getYaw(),
        at.getPitch(),
        player.getHealth(),
        player.getAbsorptionAmount(),
        velocity.getX(),
        velocity.getY(),
        velocity.getZ(),
        player.getInventory().getHeldItemSlot(),
        weapon.getType().name(),
        weapon.getEnchantmentLevel(knockback),
        player.isSprinting(),
        player.getGameMode().name(),
        player.isInvulnerable());
  }

  private Player player(UUID id) {
    if (!(plugin.getServer().getEntity(id) instanceof Player player))
      throw new IllegalStateException("original melee body missing");
    return player;
  }

  private TheStormPlugin storm() {
    if (!(plugin.getServer().getPluginManager().getPlugin("TheStorm")
        instanceof TheStormPlugin storm)) throw new IllegalStateException("TheStorm missing");
    return storm;
  }

  private static Spec load() {
    try (var stream = CombatHarness.class.getResourceAsStream("/rwf-melee-check.json")) {
      if (stream == null) throw new IllegalStateException("native melee contract missing");
      var spec = JSON.readValue(stream, Spec.class);
      if (spec.version() != 1
          || !spec.contract().equals("rwf-native-melee-check-v1")
          || !spec.trials().equals(List.of("blocked", "clear"))
          || spec.reach() != 3
          || !spec.fields().equals(names(Probe.class))
          || !spec.bodyFields().equals(names(Body.class))
          || spec.attacker().size() != 5
          || spec.victim().size() != 5
          || spec.wall().size() != 2
          || spec.wall().stream().anyMatch(point -> point.size() != 3))
        throw new IllegalStateException("native melee contract incompatible");
      return spec;
    } catch (IOException failure) {
      throw new IllegalStateException("native melee contract unreadable", failure);
    }
  }

  private static List<String> names(Class<?> type) {
    return Arrays.stream(type.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }
}
