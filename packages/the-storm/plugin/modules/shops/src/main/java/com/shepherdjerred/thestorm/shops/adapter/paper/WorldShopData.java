package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemNames;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import com.shepherdjerred.thestorm.shops.domain.sign.SignProblem;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Sign;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Only non-visible identity and exact item components live in sign metadata. */
final class WorldShopData {
  private final NamespacedKey id;
  private final NamespacedKey ownerKind;
  private final NamespacedKey ownerId;
  private final NamespacedKey ownerName;
  private final NamespacedKey item;
  private final NamespacedKey created;
  private final NamespacedKey sequence;
  private final NamespacedKey remoteContainer;
  private final ShopSignParser parser = new ShopSignParser(999_999_999, "Admin Shop");
  private final ItemTemplates templates = new ItemTemplates();

  WorldShopData(Plugin plugin) {
    id = new NamespacedKey(plugin, "shop_id");
    ownerKind = new NamespacedKey(plugin, "shop_owner_kind");
    ownerId = new NamespacedKey(plugin, "shop_owner_id");
    ownerName = new NamespacedKey(plugin, "shop_owner_name");
    item = new NamespacedKey(plugin, "shop_item");
    created = new NamespacedKey(plugin, "shop_created");
    sequence = new NamespacedKey(plugin, "shop_sequence");
    remoteContainer = new NamespacedKey(plugin, "shop_remote_container");
  }

  long lastId(org.bukkit.World world) {
    return world.getPersistentDataContainer().getOrDefault(sequence, PersistentDataType.LONG, 0L);
  }

  Optional<SignShop> read(Sign sign, SignLines lines, Optional<BlockPos> physicalContainer) {
    var data = sign.getPersistentDataContainer();
    if (!data.has(ownerKind)) return Optional.empty();
    var name = require(sign, ownerName);
    if (!lines.owner().equals(name)) return Optional.empty();
    var owner = owner(sign, name);
    var parsed = parser.parse(SignLines.of("_", lines.quantity(), lines.prices(), lines.item()));
    if (!(parsed instanceof Result.Ok<ShopSignDraft, List<SignProblem>>(var draft)))
      return Optional.empty();
    var fingerprint = fingerprint(sign, lines.item());
    if (fingerprint.isEmpty() && !lines.item().equals("?")) return Optional.empty();
    var shopId = data.get(id, PersistentDataType.LONG);
    var made = data.get(created, PersistentDataType.LONG);
    if (shopId == null || made == null)
      throw new IllegalStateException("incomplete world shop identity");
    var container = container(sign, physicalContainer);
    if (container.isEmpty() && !(owner instanceof ShopOwner.Admin(var finite) && !finite))
      return Optional.empty();
    return Optional.of(
        new SignShop(
            shopId,
            ShopBlocks.pos(sign.getBlock()),
            container,
            owner,
            draft.quantity(),
            draft.prices(),
            fingerprint,
            Instant.ofEpochMilli(made)));
  }

  private ShopOwner owner(Sign sign, String name) {
    var kind = require(sign, ownerKind);
    return switch (kind) {
      case "player" -> new ShopOwner.Player(UUID.fromString(require(sign, ownerId)), name);
      case "town" -> new ShopOwner.Town(UUID.fromString(require(sign, ownerId)), name);
      case "admin" -> new ShopOwner.Admin();
      case "custody" -> new ShopOwner.Admin(true);
      default -> throw new IllegalStateException("unknown world shop owner kind " + kind);
    };
  }

  private Optional<ItemFingerprint> fingerprint(Sign sign, String label) {
    var encoded = sign.getPersistentDataContainer().get(item, PersistentDataType.STRING);
    if (encoded != null) {
      var stored = templates.decode(encoded);
      var original =
          stored.bundleDeal()
              ? "Bundle deal"
              : ItemNames.signLabel(stored.material(), stored.special());
      if (label.equals(original)) return Optional.of(stored);
    }
    return label.equals("?") ? Optional.empty() : ItemTemplates.item(label).map(templates::plain);
  }

  private Optional<BlockPos> container(Sign sign, Optional<BlockPos> physical) {
    var data = sign.getPersistentDataContainer();
    var remote = data.get(remoteContainer, PersistentDataType.INTEGER_ARRAY);
    if (remote != null) {
      if (remote.length != 3) throw new IllegalStateException("invalid world shop container link");
      return Optional.of(new BlockPos(sign.getWorld().getUID(), remote[0], remote[1], remote[2]));
    }
    if (data.has(remoteContainer))
      throw new IllegalStateException("invalid world shop container link type");
    return physical;
  }

  void write(Sign sign, SignShop shop, String label, Optional<BlockPos> physicalContainer) {
    var data = sign.getPersistentDataContainer();
    data.set(id, PersistentDataType.LONG, shop.id());
    data.set(created, PersistentDataType.LONG, shop.createdAt().toEpochMilli());
    data.set(ownerName, PersistentDataType.STRING, label);
    if (shop.container().isPresent() && !shop.container().equals(physicalContainer)) {
      var linked = shop.container().orElseThrow();
      if (!linked.world().equals(sign.getWorld().getUID()))
        throw new IllegalArgumentException("a shop container must share its sign's world");
      data.set(
          remoteContainer,
          PersistentDataType.INTEGER_ARRAY,
          new int[] {linked.x(), linked.y(), linked.z()});
    } else {
      data.remove(remoteContainer);
    }
    data.remove(ownerId);
    switch (shop.owner()) {
      case ShopOwner.Player(var uuid, _) -> {
        data.set(ownerKind, PersistentDataType.STRING, "player");
        data.set(ownerId, PersistentDataType.STRING, uuid.toString());
      }
      case ShopOwner.Town(var uuid, _) -> {
        data.set(ownerKind, PersistentDataType.STRING, "town");
        data.set(ownerId, PersistentDataType.STRING, uuid.toString());
      }
      case ShopOwner.Admin(var finite) ->
          data.set(ownerKind, PersistentDataType.STRING, finite ? "custody" : "admin");
    }
    shop.item()
        .ifPresentOrElse(
            fingerprint -> data.set(item, PersistentDataType.STRING, fingerprint.template()),
            () -> data.remove(item));
    var world = sign.getWorld().getPersistentDataContainer();
    world.set(sequence, PersistentDataType.LONG, Math.max(lastId(sign.getWorld()), shop.id()));
  }

  private static String require(Sign sign, NamespacedKey key) {
    var value = sign.getPersistentDataContainer().get(key, PersistentDataType.STRING);
    if (value == null) throw new IllegalStateException("world shop is missing " + key);
    return value;
  }
}
