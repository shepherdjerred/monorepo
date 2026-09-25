package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Binding;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Gate;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Tag;
import org.bukkit.block.Sign;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * What a mechanism sign remembers, in its persistent data: who created it (the player whose land
 * rights redstone and pistons act with), the structure a bridge, door or gate sign is bound to, the
 * blocks it holds while the structure is open, and a cooking pot's fuel. The data travels with the
 * sign block; what it holds drops with it. Unreadable data is a broken invariant and fails.
 */
final class Signs {

  private static final String SPAN = "span";
  private static final String GATE = "gate";

  private final NamespacedKey owner;
  private final NamespacedKey stockMaterial;
  private final NamespacedKey stockCount;
  private final NamespacedKey fuel;
  private final NamespacedKey kind;
  private final NamespacedKey material;
  private final NamespacedKey anchor;
  private final NamespacedKey partner;
  private final NamespacedKey keeper;
  private final NamespacedKey tops;

  Signs(Plugin plugin) {
    owner = new NamespacedKey(plugin, "mechanic_owner");
    stockMaterial = new NamespacedKey(plugin, "mechanic_stock_material");
    stockCount = new NamespacedKey(plugin, "mechanic_stock_count");
    fuel = new NamespacedKey(plugin, "mechanic_fuel");
    kind = new NamespacedKey(plugin, "mechanic_binding");
    material = new NamespacedKey(plugin, "mechanic_material");
    anchor = new NamespacedKey(plugin, "mechanic_anchor");
    partner = new NamespacedKey(plugin, "mechanic_partner");
    keeper = new NamespacedKey(plugin, "mechanic_keeper");
    tops = new NamespacedKey(plugin, "mechanic_tops");
  }

  static boolean isSign(Material material) {
    return Tag.ALL_SIGNS.isTagged(material);
  }

  static boolean isHanging(Material material) {
    return Tag.ALL_HANGING_SIGNS.isTagged(material);
  }

  Optional<UUID> owner(Sign sign) {
    return Optional.ofNullable(
            sign.getPersistentDataContainer().get(owner, PersistentDataType.STRING))
        .map(UUID::fromString);
  }

  /** Records {@code player} as the creator. Call {@link Sign#update()} afterwards. */
  void setOwner(Sign sign, UUID player) {
    sign.getPersistentDataContainer().set(owner, PersistentDataType.STRING, player.toString());
  }

  Stock stock(Sign sign) {
    var data = sign.getPersistentDataContainer();
    var count = data.getOrDefault(stockCount, PersistentDataType.LONG, 0L);
    var held = data.get(stockMaterial, PersistentDataType.STRING);
    if (count == 0 || held == null) {
      return Stock.empty();
    }
    return Stock.of(held, count);
  }

  /** Stores {@code stock}. Call {@link Sign#update()} afterwards. */
  void setStock(Sign sign, Stock stock) {
    var data = sign.getPersistentDataContainer();
    if (stock.isEmpty()) {
      data.remove(stockMaterial);
      data.remove(stockCount);
      return;
    }
    data.set(stockMaterial, PersistentDataType.STRING, stock.material().orElseThrow());
    data.set(stockCount, PersistentDataType.LONG, stock.count());
  }

  int fuel(Sign sign) {
    return sign.getPersistentDataContainer().getOrDefault(fuel, PersistentDataType.INTEGER, 0);
  }

  /** Stores a cooking pot's fuel. Call {@link Sign#update()} afterwards. */
  void setFuel(Sign sign, int units) {
    sign.getPersistentDataContainer().set(fuel, PersistentDataType.INTEGER, units);
  }

  boolean hasBinding(Sign sign) {
    return sign.getPersistentDataContainer().has(kind, PersistentDataType.STRING);
  }

  Optional<Binding> binding(Sign sign) {
    var data = sign.getPersistentDataContainer();
    var type = data.get(kind, PersistentDataType.STRING);
    if (type == null) {
      return Optional.empty();
    }
    var bound = require(data, material);
    var at = pos(require(data, anchor));
    return switch (type) {
      case SPAN ->
          Optional.of(
              new Binding.SpanEnd(
                  bound,
                  at,
                  Optional.ofNullable(data.get(partner, PersistentDataType.STRING)).map(Signs::pos),
                  data.getOrDefault(keeper, PersistentDataType.BOOLEAN, false)));
      case GATE ->
          Optional.of(
              new Binding.GateFrame(
                  new Gate(
                      bound,
                      at,
                      Arrays.stream(require(data, tops).split(";")).map(Signs::pos).toList())));
      default -> throw new IllegalStateException("unknown sign binding: " + type);
    };
  }

  /** Stores {@code binding}, replacing any other. Call {@link Sign#update()} afterwards. */
  void setBinding(Sign sign, Binding binding) {
    clearBinding(sign);
    var data = sign.getPersistentDataContainer();
    data.set(material, PersistentDataType.STRING, binding.material());
    switch (binding) {
      case Binding.SpanEnd end -> {
        data.set(kind, PersistentDataType.STRING, SPAN);
        data.set(anchor, PersistentDataType.STRING, text(end.anchor()));
        end.partner().ifPresent(pos -> data.set(partner, PersistentDataType.STRING, text(pos)));
        data.set(keeper, PersistentDataType.BOOLEAN, end.keeper());
      }
      case Binding.GateFrame frame -> {
        data.set(kind, PersistentDataType.STRING, GATE);
        data.set(anchor, PersistentDataType.STRING, text(frame.gate().anchor()));
        data.set(
            tops,
            PersistentDataType.STRING,
            frame.gate().tops().stream().map(Signs::text).collect(Collectors.joining(";")));
      }
    }
  }

  /** Forgets any binding (the stock stays). Call {@link Sign#update()} afterwards. */
  void clearBinding(Sign sign) {
    var data = sign.getPersistentDataContainer();
    for (var key : List.of(kind, material, anchor, partner, keeper, tops)) {
      data.remove(key);
    }
  }

  private static String require(PersistentDataContainer data, NamespacedKey key) {
    var value = data.get(key, PersistentDataType.STRING);
    if (value == null) {
      throw new IllegalStateException("a bound sign is missing " + key);
    }
    return value;
  }

  private static String text(Pos pos) {
    return pos.x() + "," + pos.y() + "," + pos.z();
  }

  private static Pos pos(String text) {
    var parts = text.split(",", -1);
    if (parts.length != 3) {
      throw new IllegalStateException("not a stored position: " + text);
    }
    return new Pos(
        Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2]));
  }
}
