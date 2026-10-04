package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.companions.adapter.coreprotect.NaturalBlockAudit;
import com.shepherdjerred.thestorm.companions.adapter.db.JooqCompanionStore;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.essentials.app.StarterSupplies;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.npc.NPC;
import net.coreprotect.CoreProtect;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/** Real production runtime with a local clock, rollout gate and disposable survival world. */
public final class CompanionsE2EPlugin extends JavaPlugin implements BasicCommand {
  private @Nullable StormDatabase database;
  private @Nullable NaturalBlockAudit audit;
  private @Nullable CompanionsPaper running;
  private boolean gate = true;

  @Override
  public void onEnable() {
    var world =
        getServer().createWorld(new WorldCreator("storm_companions_test").type(WorldType.FLAT));
    if (world == null) throw new IllegalStateException("missing companion fixture world");
    prepare(world);
    var store = StormDatabase.open(getDataPath().resolve("companions-e2e.db"));
    database = store;
    store.migrate("companions", CompanionsPaper.class.getClassLoader());
    var services = new Services();
    services.provide(GlobalChat.class, new TestChat());
    services.provide(
        StarterSupplies.class,
        new StarterSupplies(
            List.of(
                encoded(new ItemStack(Material.WOODEN_PICKAXE)),
                encoded(new ItemStack(Material.WOODEN_AXE)),
                encoded(new ItemStack(Material.BREAD, 8)))));
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            store,
            services,
            getDataPath(),
            InstantSource.offset(
                InstantSource.system(),
                Duration.between(
                    InstantSource.system().instant(), Instant.parse("2026-10-03T22:00:00Z"))),
            RandomGenerator.of("L64X128MixRandom"),
            getComponentLogger());
    var config =
        new CompanionsConfig(
            3,
            "America/Los_Angeles",
            "14:00",
            "22:00",
            world.getName(),
            20,
            8,
            256,
            10,
            List.of(
                new CompanionsConfig.Identity("rowan", "Rowan", "Curious builder"),
                new CompanionsConfig.Identity("juniper", "Juniper", "Friendly farmer"),
                new CompanionsConfig.Identity("flint", "Flint", "Careful miner")),
            "http://localhost:1");
    var coreProtect = getServer().getPluginManager().getPlugin("CoreProtect");
    if (!(coreProtect instanceof CoreProtect audit))
      throw new IllegalStateException("missing audit");
    var naturalAudit = new NaturalBlockAudit(audit.getAPI());
    this.audit = naturalAudit;
    running =
        new CompanionsPaper(
            context,
            config,
            new CompanionsPaper.Parts(
                new JooqCompanionStore(store),
                () -> CompletableFuture.completedFuture(gate),
                naturalAudit,
                new FixtureProtection(),
                (identity, message, state) -> CompletableFuture.completedFuture(Optional.empty())));
    getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("companiontest", this));
    getComponentLogger().info("Enabled real-Paper companion E2E harness");
  }

  private static String encoded(ItemStack item) {
    return Base64.getEncoder().encodeToString(item.serializeAsBytes());
  }

  private static void prepare(World world) {
    for (var x = 0; x < 64; x++)
      for (var z = 0; z < 64; z++) {
        world.getBlockAt(x, -61, z).setType(Material.GRASS_BLOCK, false);
        for (var y = -60; y < -53; y++) world.getBlockAt(x, y, z).setType(Material.AIR, false);
      }
    world.setSpawnLocation(32, -60, 32);
    for (var x : new int[] {30, 31, 33, 34}) {
      world.getBlockAt(x, -60, 32).setType(Material.OAK_LOG, false);
      world.getBlockAt(x, -59, 32).setType(Material.OAK_LOG, false);
    }
    world.getBlockAt(32, -60, 33).setType(Material.OAK_LOG, false);
    world.getBlockAt(32, -59, 33).setType(Material.OAK_LOG, false);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (args.length == 0) throw new IllegalArgumentException("missing fixture command");
    switch (args[0]) {
      case "off" -> gate = false;
      case "on" -> gate = true;
      case "visit" -> visit(args[1]);
      case "kill" -> kill(args[1]);
      case "status" -> {
        status(source);
        return;
      }
      case "audit" -> {
        inspectAudit(source);
        return;
      }
      case "scan" -> {
        inspectScan(source);
        return;
      }
      case "native" -> {
        nativeActions(source);
        return;
      }
      default -> throw new IllegalArgumentException("unknown fixture command");
    }
    if (running == null) throw new IllegalStateException("fixture runtime missing");
    running.reconcile();
    source.getSender().sendMessage(Component.text("Companion test reconciliation requested"));
  }

  private void visit(String name) {
    var player = getServer().getPlayerExact(name);
    var world = getServer().getWorld("storm_companions_test");
    if (player == null || world == null) throw new IllegalStateException("missing fixture visitor");
    player.teleport(new Location(world, 32.5, -60, 34.5));
  }

  private static Player player(NPC npc) {
    if (!(npc.getEntity() instanceof Player player))
      throw new IllegalStateException("not a player");
    return player;
  }

  private static void kill(String identity) {
    for (var npc : CitizensAPI.getNPCRegistry()) {
      if (!identity.equals(npc.data().get("thestorm-companion-id")) || !npc.isSpawned()) continue;
      var player = player(npc);
      npc.getNavigator().cancelNavigation();
      player.teleport(new Location(player.getWorld(), 50.5, -60, 50.5));
      player.damage(1000);
    }
  }

  private void status(CommandSourceStack source) {
    for (var npc : CitizensAPI.getNPCRegistry()) {
      if (!npc.data().has("thestorm-companion-id") || !npc.isSpawned()) continue;
      var player = player(npc);
      var items =
          Arrays.stream(player.getInventory().getContents())
              .filter(item -> item != null)
              .map(item -> item.getType().name() + ":" + item.getAmount())
              .toList();
      source
          .getSender()
          .sendMessage(
              Component.text(
                  npc.data().get("thestorm-companion-id", "")
                      + " uuid="
                      + npc.getUniqueId()
                      + " items="
                      + items
                      + " at="
                      + requireNonNull(player.getLocation()).toVector()
                      + " target="
                      + npc.getNavigator().getTargetAsLocation()
                      + " fixtures="
                      + fixtureLogs()));
    }
  }

  private String fixtureLogs() {
    var world = getServer().getWorld("storm_companions_test");
    if (world == null) throw new IllegalStateException("fixture world missing");
    return Arrays.stream(new int[] {30, 31, 32, 33, 34})
        .mapToObj(x -> world.getBlockAt(x, -60, 32).getType().name())
        .toList()
        .toString();
  }

  private void inspectAudit(CommandSourceStack source) {
    var world = getServer().getWorld("storm_companions_test");
    var naturalAudit = audit;
    if (world == null || naturalAudit == null)
      throw new IllegalStateException("fixture audit unavailable");
    var block = world.getBlockAt(33, -60, 32);
    var natural = naturalAudit.natural(block, "#storm-fixture", "fixture").join();
    var unqueued = naturalAudit.unqueued(block, "#storm-fixture", "fixture");
    source
        .getSender()
        .sendMessage(
            Component.text(
                "audit block="
                    + block.getType()
                    + " natural="
                    + natural
                    + " unqueued="
                    + unqueued
                    + " loaded="
                    + world.isChunkLoaded(block.getX() >> 4, block.getZ() >> 4)));
  }

  private void inspectScan(CommandSourceStack source) {
    var world = getServer().getWorld("storm_companions_test");
    if (world == null) throw new IllegalStateException("fixture world missing");
    var protection = new FixtureProtection();
    var actors =
        java.util.stream.StreamSupport.stream(CitizensAPI.getNPCRegistry().spliterator(), false)
            .filter(npc -> npc.data().has("thestorm-companion-id") && npc.isSpawned())
            .map(CompanionsE2EPlugin::player)
            .toList();
    if (actors.isEmpty()) throw new IllegalStateException("companions are not spawned");
    var player = actors.getFirst();
    var scan = new ResourceScan(requireNonNull(player.getLocation()), 8);
    var actions = new SurvivalActions(protection, requireNonNull(audit));
    var candidate =
        scan.advance(
            4913,
            block ->
                Tag.LOGS.isTagged(block.getType())
                    && actions.allowed(player, ProtectedAction.BREAK, block)
                    && CompanionActor.exposed(block));
    source
        .getSender()
        .sendMessage(
            Component.text(
                "scan actor="
                    + requireNonNull(player.getLocation()).toVector()
                    + " candidate="
                    + candidate.map(block -> block.getX() + "," + block.getY() + "," + block.getZ())
                    + " finished="
                    + scan.finished()));
  }

  private void nativeActions(CommandSourceStack source) {
    var world = getServer().getWorld("storm_companions_test");
    if (world == null) throw new IllegalStateException("fixture world missing");
    var npc = CitizensAPI.getNPCRegistry().createNPC(EntityType.PLAYER, "NativeProbe [NPC]");
    npc.data().setPersistent(NPC.Metadata.REMOVE_FROM_PLAYERLIST, true);
    npc.data().setPersistent(NPC.Metadata.PICKUP_ITEMS, false);
    npc.setProtected(false);
    var at = new Location(world, 11.5, -60, 10.5);
    var cancellation = new CraftCancellation(npc.getMinecraftUniqueId());
    getServer().getPluginManager().registerEvents(cancellation, this);
    var coreProtect = getServer().getPluginManager().getPlugin("CoreProtect");
    if (!(coreProtect instanceof CoreProtect plugin))
      throw new IllegalStateException("audit missing");
    try (var audit = new NaturalBlockAudit(plugin.getAPI())) {
      if (!npc.spawn(at)) throw new IllegalStateException("native probe spawn failed");
      var player = player(npc);
      player.setGameMode(GameMode.SURVIVAL);
      player
          .getInventory()
          .addItem(new ItemStack(Material.OAK_LOG, 2), new ItemStack(Material.WOODEN_PICKAXE));
      var recipes = new NativeRecipes();
      var recipe = recipes.select(NativeRecipes.stock(player)).get("OAK_PLANKS");
      if (recipe == null) throw new IllegalStateException("native planks recipe missing");
      var cancelled = recipes.craft(player, recipe, Optional.empty());
      var afterCancel = NativeRecipes.stock(player).getOrDefault("OAK_LOG", 0);
      cancellation.cancel = false;
      var crafted = recipes.craft(player, recipe, Optional.empty());
      var afterCraft = NativeRecipes.stock(player);
      var protection = new FixtureProtection();
      var actions = new SurvivalActions(protection, audit);
      var stone = world.getBlockAt(12, -60, 10);
      stone.setType(Material.STONE, false);
      protection.deny = true;
      var denied = actions.mine(player, stone, Material.STONE, "#storm-probe");
      protection.deny = false;
      SurvivalActions.equip(player, Material.WOODEN_PICKAXE);
      var mined = actions.mine(player, stone, Material.STONE, "#storm-probe");
      var placed = actions.place(player, stone, Material.OAK_PLANKS, "#storm-probe");
      source
          .getSender()
          .sendMessage(
              Component.text(
                  "native cancelled="
                      + cancelled
                      + " retained="
                      + afterCancel
                      + " crafted="
                      + crafted
                      + " logs="
                      + afterCraft.getOrDefault("OAK_LOG", 0)
                      + " planks="
                      + afterCraft.getOrDefault("OAK_PLANKS", 0)
                      + " deniedMining="
                      + denied
                      + " mined="
                      + mined
                      + " placed="
                      + placed
                      + " remaining="
                      + NativeRecipes.stock(player).getOrDefault("OAK_PLANKS", 0)
                      + nativeEating(player)));
    } finally {
      HandlerList.unregisterAll(cancellation);
      npc.destroy();
    }
  }

  private static String nativeEating(Player player) {
    player.getInventory().addItem(new ItemStack(Material.BREAD, 2));
    player.setFoodLevel(10);
    SurvivalActions.equip(player, Material.BREAD);
    player.startUsingItem(org.bukkit.inventory.EquipmentSlot.HAND);
    player.completeUsingActiveItem();
    return " food="
        + player.getFoodLevel()
        + " bread="
        + NativeRecipes.stock(player).getOrDefault("BREAD", 0);
  }

  public static final class CraftCancellation implements Listener {
    private final UUID player;
    private boolean cancel = true;

    CraftCancellation(UUID player) {
      this.player = player;
    }

    @EventHandler
    public void craft(CraftItemEvent event) {
      if (cancel && event.getWhoClicked().getUniqueId().equals(player)) event.setCancelled(true);
    }
  }

  @Override
  public void onDisable() {
    if (running != null) running.close();
    if (database != null) database.close();
  }

  private static final class FixtureProtection implements Protection {
    private boolean deny;

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      return deny ? new Decision.Denied(Component.text("fixture denied")) : Decision.allowed();
    }

    @Override
    public Decision checkHarm(UUID attacker, Location at, HarmTarget target, Location victim) {
      return Decision.allowed();
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return true;
    }
  }

  private static final class TestChat implements GlobalChat {
    @Override
    public Subscription subscribe(Consumer<ChatLine> listener) {
      return () -> {};
    }

    @Override
    public void broadcastExternal(String source, String author, String text) {
      throw new IllegalStateException("fixture conversations are unavailable");
    }
  }
}
