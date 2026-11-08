package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.GateSignText;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.persistence.PersistentDataType;
import tools.jackson.databind.json.JsonMapper;

/** Physical signs carry stable owners and the options hidden by Stargate's rendered sign. */
public final class WorldGateData {
  private static final NamespacedKey DEFINITION =
      new NamespacedKey("thestorm", "stargate_definition");
  private static final NamespacedKey REMOVED = new NamespacedKey("thestorm", "stargate_removed");
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final Server server;
  private final com.shepherdjerred.thestorm.core.world.WorldAccountEpochs accounts;

  enum Policy {
    PUBLIC,
    PRIVATE,
    TOWN
  }

  record Definition(int version, Stargate gate, String networkName, Policy policy) {}

  record Identity(
      UUID id,
      UUID networkId,
      UUID ownerId,
      UUID worldId,
      Pos sign,
      StargateFrame frame,
      boolean fixed,
      boolean alwaysOpen) {}

  record Stored(int version, Identity gate, String networkName, Policy policy) {}

  public WorldGateData(Server server) {
    this(server, com.shepherdjerred.thestorm.core.reset.AccountEpochs.inMemory());
  }

  WorldGateData(Server server, com.shepherdjerred.thestorm.core.reset.AccountEpochs epochs) {
    this.server = server;
    accounts = new com.shepherdjerred.thestorm.core.world.WorldAccountEpochs(epochs, "stargate");
  }

  static boolean removed(Sign sign) {
    return sign.getPersistentDataContainer().has(REMOVED);
  }

  Optional<Block> block(Stargate gate) {
    var world = server.getWorld(gate.worldId());
    var pos = gate.sign();
    return world == null || !world.isChunkLoaded(pos.x() >> 4, pos.z() >> 4)
        ? Optional.empty()
        : Optional.of(world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  boolean marked(Block block) {
    return block.getState(false) instanceof Sign sign
        && (sign.getPersistentDataContainer().has(DEFINITION)
            || sign.getPersistentDataContainer().has(REMOVED));
  }

  boolean hasDefinition(Block block) {
    return block.getState(false) instanceof Sign sign
        && sign.getPersistentDataContainer().has(DEFINITION)
        && !sign.getPersistentDataContainer().has(REMOVED);
  }

  public void write(Stargate gate, StargateNetwork network) {
    if (!gate.networkId().equals(network.id()))
      throw new IllegalArgumentException("gate network differs");
    var block = block(gate).orElseThrow(() -> new IllegalStateException("gate sign is unloaded"));
    if (!(block.getState() instanceof Sign sign))
      throw new IllegalStateException("gate sign is missing");
    var policy =
        switch (network.access()) {
          case NetworkAccess.Public _ -> Policy.PUBLIC;
          case NetworkAccess.Private _ -> Policy.PRIVATE;
          case NetworkAccess.Town _ -> Policy.TOWN;
        };
    var identities = new java.util.HashSet<UUID>();
    identities.add(gate.ownerId());
    if (network.access() instanceof NetworkAccess.Private(var owner, _)) identities.add(owner);
    accounts.stamp(sign.getPersistentDataContainer(), identities);
    sign.getPersistentDataContainer()
        .set(
            DEFINITION,
            PersistentDataType.STRING,
            JSON.writeValueAsString(
                new Stored(
                    1,
                    new Identity(
                        gate.id(),
                        gate.networkId(),
                        gate.ownerId(),
                        gate.worldId(),
                        gate.sign(),
                        gate.frame(),
                        gate.fixedDestination() != null,
                        gate.alwaysOpen()),
                    network.name(),
                    policy)));
    sign.getPersistentDataContainer().remove(REMOVED);
    var rendered = GateSignText.display(gate, network, "");
    for (var line = 0; line < rendered.size(); line++)
      sign.getSide(Side.FRONT).line(line, Component.text(rendered.get(line)));
    if (!sign.update(false, false))
      throw new IllegalStateException("gate sign changed while saving");
  }

  void remove(Stargate gate) {
    var block = block(gate).orElseThrow(() -> new IllegalStateException("gate sign is unloaded"));
    if (!(block.getState() instanceof Sign sign)) return;
    sign.getPersistentDataContainer().remove(DEFINITION);
    sign.getPersistentDataContainer().set(REMOVED, PersistentDataType.BOOLEAN, true);
    if (!sign.update(false, false))
      throw new IllegalStateException("gate sign changed while removing");
  }

  Optional<Definition> read(Block block) {
    if (!(block.getState(false) instanceof Sign sign)) return Optional.empty();
    var data = sign.getPersistentDataContainer();
    if (data.has(REMOVED)) return Optional.empty();
    var encoded = data.get(DEFINITION, PersistentDataType.STRING);
    if (encoded == null) {
      if (data.has(DEFINITION)) throw new IllegalStateException("invalid world gate metadata type");
      return Optional.empty();
    }
    var definition =
        switch (StrictYaml.parseJson("world gate " + block.getLocation(), encoded, Stored.class)) {
          case Result.Ok<Stored, List<Problem>>(var value) -> value;
          case Result.Err<Stored, List<Problem>>(var problems) ->
              throw new IllegalStateException("invalid world gate: " + problems);
        };
    if (definition.version() != 1) throw new IllegalStateException("unknown world gate version");
    if (!accounts.permits(data, definition.gate().ownerId()) || !accounts.permitsAll(data))
      return Optional.empty();
    return fromWorld(block, definition);
  }

  private Optional<Definition> fromWorld(Block block, Stored definition) {
    var original = definition.gate();
    var sign = (Sign) block.getState(false);
    var lines = PaperGrid.frontLines(sign);
    // The creation layout's visible name, network, destination and A option override the index.
    if (!GateSignText.network(lines).equalsIgnoreCase(definition.networkName()))
      return Optional.empty();
    if (!GateSignText.rendered(lines)
        && !lines.get(3).isBlank()
        && !lines.get(3).strip().equalsIgnoreCase("A")) return Optional.empty();
    var actual = PaperGrid.pos(block);
    var frame =
        new StargateFrame(
            move(original.frame().origin(), original.sign(), actual),
            original.frame().across(),
            original.frame().shape());
    final Stargate gate;
    try {
      gate =
          new Stargate(
              original.id(),
              original.networkId(),
              GateSignText.name(lines),
              original.ownerId(),
              block.getWorld().getUID(),
              actual,
              frame,
              original.fixed() ? GateSignText.destination(lines) : null,
              GateSignText.rendered(lines)
                  ? original.alwaysOpen()
                  : lines.get(3).strip().equalsIgnoreCase("A"));
    } catch (IllegalArgumentException error) {
      return Optional.empty();
    }
    var network =
        new StargateNetwork(gate.networkId(), definition.networkName(), new NetworkAccess.Public());
    var grid = new PaperGrid(block.getWorld());
    if (!StargateIntegrity.valid(grid, gate, network, false)
        && !StargateIntegrity.recoverable(grid, gate, network)) return Optional.empty();
    return Optional.of(new Definition(1, gate, definition.networkName(), definition.policy()));
  }

  private static Pos move(Pos point, Pos origin, Pos actual) {
    return new Pos(
        actual.x() + point.x() - origin.x(),
        actual.y() + point.y() - origin.y(),
        actual.z() + point.z() - origin.z());
  }
}
