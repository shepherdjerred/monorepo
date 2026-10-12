package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;

/** Temporary wards own their native capacity and remove only their unspent absorption. */
final class SurvivalWards {
  enum Source {
    CLASS,
    STONEWARD,
    SOULBOND,
    ECHOHEART
  }

  private record Grant(AttributeModifier modifier, double remaining, Instant expires) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Map<Source, Grant>> grants = new HashMap<>();

  SurvivalWards(SurvivalRunner runner) {
    this.runner = runner;
  }

  void grant(Player player, Source source, double requested, int seconds) {
    remove(player, source);
    var amount =
        source == Source.CLASS ? requested : Math.max(0, requested - player.getAbsorptionAmount());
    if (amount <= 0) return;
    var modifier =
        new AttributeModifier(
            new org.bukkit.NamespacedKey(
                runner.context().plugin(),
                "survival_ward_" + source.name().toLowerCase(java.util.Locale.ROOT)),
            amount,
            AttributeModifier.Operation.ADD_NUMBER,
            org.bukkit.inventory.EquipmentSlotGroup.ANY);
    java.util.Objects.requireNonNull(player.getAttribute(Attribute.MAX_ABSORPTION))
        .addTransientModifier(modifier);
    player.setAbsorptionAmount(player.getAbsorptionAmount() + amount);
    grants
        .computeIfAbsent(player.getUniqueId(), _ -> new EnumMap<>(Source.class))
        .put(
            source,
            new Grant(modifier, amount, runner.context().time().instant().plusSeconds(seconds)));
  }

  void absorbed(Player player, double amount) {
    var owned = grants.get(player.getUniqueId());
    if (owned == null) return;
    var ordered =
        owned.entrySet().stream()
            .sorted(java.util.Comparator.comparing(entry -> entry.getValue().expires()))
            .toList();
    var remaining = amount;
    for (var entry : ordered) {
      var grant = entry.getValue();
      var used = Math.min(remaining, grant.remaining());
      owned.put(
          entry.getKey(), new Grant(grant.modifier(), grant.remaining() - used, grant.expires()));
      remaining -= used;
    }
  }

  void tick() {
    var now = runner.context().time().instant();
    for (var id : List.copyOf(grants.keySet())) {
      var player = runner.context().server().getPlayer(id);
      if (player == null) continue;
      if (!runner.isFighter(id)) {
        leave(id);
        continue;
      }
      var owned = java.util.Objects.requireNonNull(grants.get(id));
      for (var source : List.copyOf(owned.keySet()))
        if (!now.isBefore(java.util.Objects.requireNonNull(owned.get(source)).expires()))
          remove(player, source);
    }
  }

  void remove(Player player, Source source) {
    var owned = grants.get(player.getUniqueId());
    if (owned == null) return;
    var grant = owned.remove(source);
    if (grant == null) return;
    player.setAbsorptionAmount(Math.max(0, player.getAbsorptionAmount() - grant.remaining()));
    java.util.Objects.requireNonNull(player.getAttribute(Attribute.MAX_ABSORPTION))
        .removeModifier(grant.modifier());
    if (owned.isEmpty()) grants.remove(player.getUniqueId());
  }

  void leave(UUID id) {
    var player = runner.context().server().getPlayer(id);
    if (player != null) for (var source : Source.values()) remove(player, source);
    grants.remove(id);
  }

  void reset() {
    List.copyOf(grants.keySet()).forEach(this::leave);
  }
}
