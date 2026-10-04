package com.shepherdjerred.thestorm.mechanics.e2e;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.mechanics.MechanicsModule;
import java.time.InstantSource;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.permissions.PermissionAttachment;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

/** Test-only plugin that runs the production mechanics module against real Paper physics. */
@NullMarked
public final class MechanicsE2EPlugin extends JavaPlugin implements Listener {

  private static final int BRIDGE_Y = -55;
  // Synthetic machinery belongs outside the shipped town and arena protections.
  private static final int BRIDGE_X = 400;
  private static final int PISTON_X = 408;
  private static final int PISTON_Y = -45;
  private static final int PISTON_Z = 0;

  private @Nullable StormDatabase database;
  private final Set<PermissionAttachment> attachments = new HashSet<>();

  @Override
  public void onEnable() {
    var database = StormDatabase.open(getDataPath().resolve("mechanics-e2e.db"));
    this.database = database;
    var services = new Services();
    services.provide(Protection.class, new OpenProtection());
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            database,
            services,
            getDataPath(),
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    new MechanicsModule().enable(context);
    var world = getServer().getWorld("world");
    if (world == null) {
      throw new IllegalStateException("Paper did not load the E2E world");
    }
    prepareBridge(world);
    prepareSuperPush(world);
    getServer().getPluginManager().registerEvents(this, this);
    getComponentLogger().info("Enabled real-Paper mechanics E2E harness");
  }

  @Override
  public void onDisable() {
    for (var attachment : attachments) {
      attachment.remove();
    }
    if (database != null) {
      database.close();
    }
  }

  @EventHandler
  void grantTestTrackPermissions(PlayerJoinEvent event) {
    Player player = event.getPlayer();
    for (int level = 1; level <= 5; level++) {
      attachments.add(player.addAttachment(this, "thestorm.track.mechanic." + level, true));
    }
  }

  private void prepareBridge(World world) {
    for (int x = BRIDGE_X - 2; x <= BRIDGE_X + 2; x++) {
      for (int z = -2; z <= 5; z++) {
        set(world.getBlockAt(x, BRIDGE_Y - 2, z), "minecraft:stone");
      }
    }
    var near = world.getBlockAt(BRIDGE_X, BRIDGE_Y, 0);
    var far = world.getBlockAt(BRIDGE_X, BRIDGE_Y, 4);
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y, 1), "minecraft:stone");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y, 3), "minecraft:stone");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y + 1, 0), "minecraft:oak_planks");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y + 1, 4), "minecraft:oak_planks");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y + 1, 1), "minecraft:oak_planks");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y + 1, 2), "minecraft:oak_planks");
    set(world.getBlockAt(BRIDGE_X, BRIDGE_Y + 1, 3), "minecraft:oak_planks");
    configureSign(near, "north", "[Bridge]");
    configureSign(far, "south", "[Bridge]");
    bindSpan(near, BRIDGE_X + "," + (BRIDGE_Y + 1) + ",0", BRIDGE_X + "," + BRIDGE_Y + ",4", true);
    bindSpan(far, BRIDGE_X + "," + (BRIDGE_Y + 1) + ",4", BRIDGE_X + "," + BRIDGE_Y + ",0", false);
  }

  private void prepareSuperPush(World world) {
    var piston = world.getBlockAt(PISTON_X, PISTON_Y, PISTON_Z);
    piston.setBlockData(Bukkit.createBlockData("minecraft:piston[facing=east]"), false);
    var sign = world.getBlockAt(PISTON_X, PISTON_Y, PISTON_Z - 1);
    sign.setBlockData(Bukkit.createBlockData("minecraft:oak_wall_sign[facing=north]"), false);
    configureSign(sign, "north", "[SuperPush]");
    owner(sign);
    set(world.getBlockAt(PISTON_X + 2, PISTON_Y, PISTON_Z), "minecraft:stone");
    set(world.getBlockAt(PISTON_X + 3, PISTON_Y, PISTON_Z), "minecraft:stone");
    set(world.getBlockAt(PISTON_X + 4, PISTON_Y, PISTON_Z), "minecraft:air");
    set(world.getBlockAt(PISTON_X + 5, PISTON_Y, PISTON_Z), "minecraft:air");
    set(world.getBlockAt(PISTON_X + 6, PISTON_Y, PISTON_Z), "minecraft:air");
    set(world.getBlockAt(PISTON_X + 7, PISTON_Y, PISTON_Z), "minecraft:air");
    set(world.getBlockAt(PISTON_X + 8, PISTON_Y, PISTON_Z), "minecraft:air");
  }

  private void bindSpan(Block block, String anchor, String partner, boolean keeper) {
    var sign = requireSign(block);
    var data = sign.getPersistentDataContainer();
    data.set(key("mechanic_binding"), PersistentDataType.STRING, "span");
    data.set(key("mechanic_material"), PersistentDataType.STRING, "minecraft:oak_planks");
    data.set(key("mechanic_anchor"), PersistentDataType.STRING, anchor);
    data.set(key("mechanic_partner"), PersistentDataType.STRING, partner);
    data.set(key("mechanic_keeper"), PersistentDataType.BOOLEAN, keeper);
    sign.update(true, false);
  }

  private void configureSign(Block block, String facing, String tag) {
    block.setBlockData(
        Bukkit.createBlockData("minecraft:oak_wall_sign[facing=" + facing + "]"), false);
    var sign = requireSign(block);
    var front = sign.getSide(Side.FRONT);
    front.line(0, Component.empty());
    front.line(1, Component.text(tag));
    front.line(2, Component.empty());
    front.line(3, Component.empty());
    sign.update(true, false);
    owner(block);
  }

  private void owner(Block block) {
    var sign = requireSign(block);
    sign.getPersistentDataContainer()
        .set(
            key("mechanic_owner"),
            PersistentDataType.STRING,
            "00000000-0000-0000-0000-000000000001");
    sign.update(true, false);
  }

  private NamespacedKey key(String value) {
    return new NamespacedKey(this, value);
  }

  private static Sign requireSign(Block block) {
    if (!(block.getState() instanceof Sign sign)) {
      throw new IllegalStateException("expected sign at " + block.getLocation());
    }
    return sign;
  }

  private static void set(Block block, String data) {
    BlockData state = Bukkit.createBlockData(data);
    block.setBlockData(state, false);
  }

  private static final class OpenProtection implements Protection {

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      return Decision.allowed();
    }

    @Override
    public Decision checkHarm(
        UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
      return Decision.allowed();
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return true;
    }
  }
}
