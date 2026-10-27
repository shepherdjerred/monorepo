package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Validated in-memory snapshot of the durable Stargate network. Main thread only. */
public final class StargateRegistry {
  private final Map<UUID, StargateNetwork> networks = new HashMap<>();
  private final Map<String, UUID> networkNames = new HashMap<>();
  private final Map<UUID, Stargate> gates = new HashMap<>();
  private final Map<Place, UUID> signs = new HashMap<>();
  private final Map<Place, UUID> buttons = new HashMap<>();
  private final Map<Place, UUID> interiors = new HashMap<>();
  private final Map<GateName, UUID> gateNames = new HashMap<>();
  private final Map<Place, UUID> occupied = new HashMap<>();

  private record Place(UUID world, Pos pos) {}

  private record GateName(UUID network, String name) {}

  /** Refuse corrupted or conflicting stored data instead of silently losing a gate. */
  public StargateRegistry(StargateStore.Snapshot snapshot) {
    for (var network : snapshot.networks()) {
      if (networks.putIfAbsent(network.id(), network) != null
          || networkNames.putIfAbsent(key(network.name()), network.id()) != null) {
        throw new IllegalStateException("duplicate Stargate network " + network.name());
      }
    }
    for (var gate : snapshot.gates()) register(gate);
  }

  private void register(Stargate gate) {
    if (!networks.containsKey(gate.networkId())) {
      throw new IllegalStateException("Stargate references a missing network: " + gate.id());
    }
    if (gates.putIfAbsent(gate.id(), gate) != null
        || signs.putIfAbsent(new Place(gate.worldId(), gate.sign()), gate.id()) != null
        || buttons.putIfAbsent(new Place(gate.worldId(), gate.button()), gate.id()) != null
        || gateNames.putIfAbsent(new GateName(gate.networkId(), key(gate.name())), gate.id())
            != null) {
      throw new IllegalStateException("duplicate Stargate " + gate.name());
    }
    for (var pos : gate.frame().interior()) {
      if (interiors.putIfAbsent(new Place(gate.worldId(), pos), gate.id()) != null) {
        throw new IllegalStateException("overlapping Stargates at " + pos);
      }
    }
    var cells = new java.util.HashSet<>(gate.frame().frameBlocks());
    cells.addAll(gate.frame().interior());
    cells.add(gate.sign());
    cells.add(gate.button());
    for (var pos : cells) {
      if (occupied.putIfAbsent(new Place(gate.worldId(), pos), gate.id()) != null) {
        throw new IllegalStateException("overlapping Stargate structures at " + pos);
      }
    }
  }

  public Optional<StargateNetwork> network(UUID id) {
    return Optional.ofNullable(networks.get(id));
  }

  public Optional<StargateNetwork> network(String name) {
    return Optional.ofNullable(networkNames.get(key(name))).flatMap(this::network);
  }

  public Optional<Stargate> gate(UUID id) {
    return Optional.ofNullable(gates.get(id));
  }

  public Optional<Stargate> gate(UUID network, String name) {
    return Optional.ofNullable(gateNames.get(new GateName(network, key(name)))).flatMap(this::gate);
  }

  public List<Stargate> gates() {
    return List.copyOf(gates.values());
  }

  public Optional<Stargate> sign(UUID world, Pos pos) {
    return Optional.ofNullable(signs.get(new Place(world, pos))).flatMap(this::gate);
  }

  public Optional<Stargate> interior(UUID world, Pos pos) {
    return Optional.ofNullable(interiors.get(new Place(world, pos))).flatMap(this::gate);
  }

  public Optional<Stargate> button(UUID world, Pos pos) {
    return Optional.ofNullable(buttons.get(new Place(world, pos))).flatMap(this::gate);
  }

  public Optional<Stargate> occupied(UUID world, Pos pos) {
    return Optional.ofNullable(occupied.get(new Place(world, pos))).flatMap(this::gate);
  }

  /** Stable alphabetical ordering makes cycling destinations predictable. */
  public List<Stargate> destinations(Stargate source) {
    return gates.values().stream()
        .filter(
            gate -> gate.networkId().equals(source.networkId()) && !gate.id().equals(source.id()))
        .sorted(Comparator.comparing(gate -> key(gate.name())))
        .toList();
  }

  private static String key(String name) {
    return name.toLowerCase(Locale.ROOT);
  }
}
