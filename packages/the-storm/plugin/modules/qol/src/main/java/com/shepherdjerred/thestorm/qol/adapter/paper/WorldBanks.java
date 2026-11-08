package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.StoredShelf;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.sign.Side;
import org.bukkit.persistence.PersistentDataType;
import tools.jackson.databind.json.JsonMapper;

/** The bank's ownership, permissions and non-visible links travel with its master container. */
final class WorldBanks {
  private static final NamespacedKey KEY = new NamespacedKey("thestorm", "bank_definition");
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final Server server;
  private final com.shepherdjerred.thestorm.core.reset.AccountEpochs epochs;
  private final com.shepherdjerred.thestorm.core.world.WorldAccountEpochs accounts;

  record VisibleShelf(String id, List<String> lines) {}

  record Definition(int version, StoredBank bank, List<VisibleShelf> visible) {}

  WorldBanks(Server server, com.shepherdjerred.thestorm.core.reset.AccountEpochs epochs) {
    this.server = server;
    this.epochs = epochs;
    accounts = new com.shepherdjerred.thestorm.core.world.WorldAccountEpochs(epochs, "bank");
  }

  Optional<StoredBank> legacy(StoredBank bank) {
    if (epochs.current(bank.owner()) != 0) return Optional.empty();
    var grants =
        bank.grants().entrySet().stream()
            .filter(entry -> epochs.current(entry.getKey()) == 0)
            .collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                    java.util.Map.Entry::getKey, java.util.Map.Entry::getValue));
    return Optional.of(
        new StoredBank(
            bank.id(), bank.owner(), bank.sign(), bank.container(), grants, bank.shelves()));
  }

  boolean hasDefinition(Block container) {
    return container.getState(false) instanceof TileState state
        && state.getPersistentDataContainer().has(KEY);
  }

  boolean hasMasterSign(StoredBank bank) {
    if (bank.sign().equals(bank.container()))
      return block(bank.container()).filter(BankBlocks::isContainer).isPresent();
    return block(bank.sign())
        .filter(sign ->
            sign.getState(false) instanceof Sign current
                && lines(current).getFirst().equalsIgnoreCase("[Bank]"))
        .isPresent();
  }

  void write(StoredBank bank) {
    write(bank, List.of());
  }

  void grant(StoredBank bank, UUID player) {
    if (!bank.grants().containsKey(player))
      throw new IllegalArgumentException("authorized player has no bank grant");
    write(bank, List.of(player));
  }

  private void write(StoredBank bank, List<UUID> renewed) {
    var container =
        block(bank.container())
            .orElseThrow(() -> new IllegalStateException("bank container is not loaded"));
    if (!(container.getState() instanceof TileState state))
      throw new IllegalStateException("bank has no container");
    var previous = definition(state);
    if (previous.isEmpty() || !previous.orElseThrow().bank().id().equals(bank.id())) {
      var identities = new java.util.HashSet<>(bank.grants().keySet());
      identities.add(bank.owner());
      accounts.stamp(state.getPersistentDataContainer(), identities);
    } else {
      accounts.renew(state.getPersistentDataContainer(), renewed);
    }
    var visible = new ArrayList<VisibleShelf>();
    for (var shelf : bank.shelves()) {
      block(shelf.sign())
          .filter(sign -> sign.getState(false) instanceof Sign)
          .ifPresent(sign ->
              visible.add(new VisibleShelf(shelf.id(), lines((Sign) sign.getState(false)))));
    }
    state
        .getPersistentDataContainer()
        .set(
            KEY,
            PersistentDataType.STRING,
            JSON.writeValueAsString(new Definition(1, bank, visible)));
    if (!state.update(false, false))
      throw new IllegalStateException("bank container changed while saving");
  }

  Optional<StoredBank> read(Block container) {
    if (!BankBlocks.isContainer(container)) return Optional.empty();
    if (!(container.getState(false) instanceof TileState state)) return Optional.empty();
    var saved = definition(state);
    if (saved.isEmpty()) return Optional.empty();
    var definition = saved.orElseThrow();
    var bank = definition.bank();
    var data = state.getPersistentDataContainer();
    if (!accounts.permits(data, bank.owner())) return Optional.empty();
    var grants =
        bank.grants().entrySet().stream()
            .filter(entry -> accounts.permits(data, entry.getKey()))
            .collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                    java.util.Map.Entry::getKey, java.util.Map.Entry::getValue));
    var actual = BankBlocks.spot(container);
    var origin = bank.container();
    var master = move(bank.sign(), origin, actual);
    var masterBlock = block(master);
    if (!master.equals(actual)
        && masterBlock.isPresent()
        && (!(masterBlock.orElseThrow().getState(false) instanceof Sign sign)
            || !lines(sign).getFirst().equalsIgnoreCase("[Bank]"))) return Optional.empty();
    var moved = !actual.equals(origin);
    var id =
        moved
            ? UUID.nameUUIDFromBytes((bank.id() + actual).getBytes(StandardCharsets.UTF_8))
                .toString()
            : bank.id();
    var shelves = new ArrayList<StoredShelf>();
    for (var shelf : bank.shelves())
      locatedShelf(shelf, definition, actual).ifPresent(shelves::add);
    return Optional.of(
        new StoredBank(
            id, bank.owner(), move(bank.sign(), origin, actual), actual, grants, shelves));
  }

  private static Optional<Definition> definition(TileState state) {
    var encoded = state.getPersistentDataContainer().get(KEY, PersistentDataType.STRING);
    if (encoded == null) {
      if (state.getPersistentDataContainer().has(KEY))
        throw new IllegalStateException("invalid world bank metadata type");
      return Optional.empty();
    }
    var parsed =
        StrictYaml.parseJson("world bank " + state.getLocation(), encoded, Definition.class);
    var definition =
        switch (parsed) {
          case Result.Ok<Definition, List<Problem>>(var value) -> value;
          case Result.Err<Definition, List<Problem>>(var problems) ->
              throw new IllegalStateException("invalid world bank: " + problems);
        };
    if (definition.version() != 1) throw new IllegalStateException("unknown world bank version");
    return Optional.of(definition);
  }

  private Optional<StoredShelf> locatedShelf(
      StoredShelf original, Definition definition, Spot actual) {
    var origin = definition.bank().container();
    var shelf =
        new StoredShelf(
            original.id(),
            move(original.sign(), origin, actual),
            move(original.container(), origin, actual),
            original.restack(),
            original.materials());
    var sign = block(shelf.sign());
    if (shelf.sign().equals(shelf.container()) || sign.isEmpty()) return Optional.of(shelf);
    if (!(sign.orElseThrow().getState(false) instanceof Sign current)) return Optional.empty();
    var text = lines(current);
    if (!text.getFirst().equalsIgnoreCase("[Shelf]")) return Optional.empty();
    var baseline =
        definition.visible().stream().filter(saved -> saved.id().equals(original.id())).findFirst();
    return Optional.of(
        baseline.isEmpty() || !baseline.orElseThrow().lines().equals(text)
            ? filters(shelf, text)
            : shelf);
  }

  void remove(StoredBank bank) {
    block(bank.container())
        .ifPresent(container -> {
          if (container.getState() instanceof TileState state) {
            state.getPersistentDataContainer().remove(KEY);
            if (!state.update(false, false))
              throw new IllegalStateException("bank changed while deleting its metadata");
          }
        });
  }

  private Optional<Block> block(Spot spot) {
    var world = server.getWorld(spot.world());
    return world == null || !world.isChunkLoaded(spot.x() >> 4, spot.z() >> 4)
        ? Optional.empty()
        : Optional.of(world.getBlockAt(spot.x(), spot.y(), spot.z()));
  }

  private static Spot move(Spot spot, Spot origin, Spot actual) {
    if (!spot.world().equals(origin.world()))
      throw new IllegalStateException("a bank link crosses worlds");
    return new Spot(
        actual.world(),
        actual.x() + spot.x() - origin.x(),
        actual.y() + spot.y() - origin.y(),
        actual.z() + spot.z() - origin.z());
  }

  private static List<String> lines(Sign sign) {
    return sign.getSide(Side.FRONT).lines().stream()
        .map(
            net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                ::serialize)
        .map(String::strip)
        .toList();
  }

  private static StoredShelf filters(StoredShelf shelf, List<String> text) {
    var materials = new LinkedHashSet<String>();
    var restack = false;
    for (var line : text.subList(1, 4)) {
      if (line.isBlank()) continue;
      if (line.equalsIgnoreCase("restack")) {
        restack = true;
      } else {
        var material = Material.matchMaterial(line);
        if (material == null || !material.isItem() || material.isAir())
          throw new IllegalStateException("invalid shelf item " + line);
        materials.add(material.getKey().toString());
      }
    }
    return new StoredShelf(shelf.id(), shelf.sign(), shelf.container(), restack, materials);
  }
}
