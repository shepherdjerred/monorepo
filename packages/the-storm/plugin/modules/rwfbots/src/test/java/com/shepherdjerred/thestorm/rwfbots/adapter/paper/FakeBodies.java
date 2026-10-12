package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Bodies over MockBukkit players: a body joins the server when spawned and disconnects when
 * despawned, moves a step towards its target when told to, and records every order it is given so
 * tests can read what the driver asked for. Item use is simulated: the body "holds" the type in its
 * main hand, or what a test put there.
 */
public final class FakeBodies implements Bodies {

  /** How far a body walks per order, in blocks. */
  public static final double STEP = 0.28;

  private final ServerMock server;
  private final Map<UUID, PlayerMock> pending = new LinkedHashMap<>();
  private final Map<UUID, PlayerMock> spawned = new LinkedHashMap<>();
  private final Set<UUID> known = new HashSet<>();
  private final Map<UUID, ActiveItem> using = new HashMap<>();
  private final List<String> orders = new ArrayList<>();
  private @Nullable Runnable afterNextOrder;
  private int created;

  public FakeBodies(ServerMock server) {
    this.server = server;
  }

  @Override
  public UUID create(Personality personality) {
    created++;
    var player = new PlayerMock(server, personality.name(), UUID.randomUUID());
    pending.put(player.getUniqueId(), player);
    known.add(player.getUniqueId());
    return player.getUniqueId();
  }

  @Override
  public void spawn(UUID bot, Location at) {
    var player = pending.remove(bot);
    if (player == null) {
      throw new IllegalArgumentException("unknown body " + bot);
    }
    spawned.put(bot, player);
    server.addPlayer(player);
    player.teleport(at);
    order("spawn " + player.getName());
  }

  @Override
  public void despawn(UUID bot) {
    pending.remove(bot);
    var player = spawned.remove(bot);
    if (player != null) {
      order("despawn " + player.getName());
      if (player.isOnline()) {
        player.disconnect();
      }
    }
  }

  @Override
  public Optional<Player> entity(UUID bot) {
    return Optional.ofNullable(spawned.get(bot)).filter(PlayerMock::isOnline).map(p -> p);
  }

  @Override
  public boolean isBot(UUID entity) {
    return known.contains(entity);
  }

  @Override
  public Set<UUID> living() {
    return Set.copyOf(spawned.keySet());
  }

  @Override
  public void despawnAll() {
    for (var bot : List.copyOf(spawned.keySet())) {
      despawn(bot);
    }
    pending.clear();
  }

  @Override
  public void moveToward(UUID bot, Location target, boolean sprint) {
    var player = player(bot);
    var from = player.getLocation();
    var delta = target.toVector().subtract(from.toVector());
    delta.setY(0);
    if (delta.lengthSquared() > STEP * STEP) {
      delta.normalize().multiply(STEP);
    }
    var to = from.clone().add(delta);
    to.setYaw(from.getYaw());
    to.setPitch(from.getPitch());
    player.teleport(to);
    player.setSprinting(sprint);
    order("move " + player.getName() + (sprint ? " sprint" : ""));
  }

  @Override
  public void stop(UUID bot) {
    player(bot).setSprinting(false);
    order("stop " + player(bot).getName());
  }

  @Override
  public void look(UUID bot, float yaw, float pitch) {
    player(bot).setRotation(yaw, pitch);
    order("look " + player(bot).getName());
  }

  @Override
  public void jump(UUID bot) {
    order("jump " + player(bot).getName());
  }

  @Override
  public void sneak(UUID bot, boolean sneaking) {
    player(bot).setSneaking(sneaking);
    order("sneak " + player(bot).getName() + " " + sneaking);
  }

  @Override
  public void selectSlot(UUID bot, int slot) {
    player(bot).getInventory().setHeldItemSlot(slot);
    order("slot " + player(bot).getName() + " " + slot);
  }

  @Override
  public void swing(UUID bot) {
    order("swing " + player(bot).getName());
  }

  @Override
  public void startUsing(UUID bot) {
    var held = player(bot).getInventory().getItemInMainHand().getType();
    using.put(bot, new ActiveItem(held, 0));
    order("use " + player(bot).getName() + " " + held);
  }

  @Override
  public void stopUsing(UUID bot, boolean complete) {
    using.remove(bot);
    order((complete ? "finish " : "release ") + player(bot).getName());
  }

  @Override
  public Optional<ActiveItem> activeItem(UUID bot) {
    return Optional.ofNullable(using.get(bot));
  }

  /** Puts {@code bot} in the middle of using {@code type} for {@code usedTicks}. */
  public void using(UUID bot, Material type, int usedTicks) {
    using.put(bot, new ActiveItem(type, usedTicks));
  }

  /**
   * Runs {@code then} once, right after the next order, inside the driver's call: how a test makes
   * rwf react synchronously to a bot's action, the way a killing blow ends a match mid-tick.
   */
  public void afterNextOrder(Runnable then) {
    afterNextOrder = then;
  }

  private void order(String order) {
    orders.add(order);
    var then = afterNextOrder;
    if (then != null) {
      afterNextOrder = null;
      then.run();
    }
  }

  /** Everything the bodies were told, oldest first, since the last call. */
  public List<String> orders() {
    var copy = List.copyOf(orders);
    orders.clear();
    return copy;
  }

  /** The player behind {@code bot}, spawned or not. */
  public PlayerMock player(UUID bot) {
    var player = spawned.get(bot);
    if (player == null) {
      player = pending.get(bot);
    }
    if (player == null) {
      throw new IllegalArgumentException("unknown body " + bot);
    }
    return player;
  }

  public List<PlayerMock> spawned() {
    return List.copyOf(spawned.values());
  }

  public int created() {
    return created;
  }
}
