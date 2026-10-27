package com.shepherdjerred.thestorm.mechanics.adapter.db;

import static com.shepherdjerred.thestorm.mechanics.adapter.db.generated.Tables.MECHANICS_STARGATE_GATE;
import static com.shepherdjerred.thestorm.mechanics.adapter.db.generated.Tables.MECHANICS_STARGATE_INVITE;
import static com.shepherdjerred.thestorm.mechanics.adapter.db.generated.Tables.MECHANICS_STARGATE_NETWORK;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.mechanics.adapter.db.generated.tables.records.MechanicsStargateGateRecord;
import com.shepherdjerred.thestorm.mechanics.adapter.db.generated.tables.records.MechanicsStargateNetworkRecord;
import com.shepherdjerred.thestorm.mechanics.app.StargateStore;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** SQLite persistence. Every write is committed by the database's single writer. */
public final class JooqStargateStore implements StargateStore {
  private final StormDatabase database;

  public JooqStargateStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Snapshot> load() {
    return database.read(
        dsl ->
            dsl.transactionResult(
                configuration -> {
                  var tx = configuration.dsl();
                  var invitations = new HashMap<UUID, Set<UUID>>();
                  for (var row : tx.selectFrom(MECHANICS_STARGATE_INVITE).fetch()) {
                    invitations
                        .computeIfAbsent(UUID.fromString(row.getNetworkId()), _ -> new HashSet<>())
                        .add(UUID.fromString(row.getPlayerId()));
                  }
                  var networks =
                      tx.selectFrom(MECHANICS_STARGATE_NETWORK).fetch().stream()
                          .map(row -> network(row, invitations))
                          .toList();
                  var gates =
                      tx.selectFrom(MECHANICS_STARGATE_GATE).fetch().stream()
                          .map(JooqStargateStore::gate)
                          .toList();
                  return new Snapshot(networks, gates);
                }));
  }

  @Override
  public CompletableFuture<Void> createNetwork(StargateNetwork network) {
    return database.write(
        dsl -> {
          var row = dsl.newRecord(MECHANICS_STARGATE_NETWORK);
          row.setId(network.id().toString());
          row.setName(network.name());
          row.setNameKey(key(network.name()));
          switch (network.access()) {
            case NetworkAccess.Public _ -> row.setKind("public");
            case NetworkAccess.Private(var owner, _) -> {
              row.setKind("private");
              row.setOwnerId(owner.toString());
            }
            case NetworkAccess.Town(var town) -> {
              row.setKind("town");
              row.setTownId(town.toString());
            }
          }
          row.store();
          if (network.access() instanceof NetworkAccess.Private(_, var invited)) {
            for (var player : invited) {
              dsl.insertInto(MECHANICS_STARGATE_INVITE)
                  .set(MECHANICS_STARGATE_INVITE.NETWORK_ID, network.id().toString())
                  .set(MECHANICS_STARGATE_INVITE.PLAYER_ID, player.toString())
                  .execute();
            }
          }
          return null;
        });
  }

  @Override
  public CompletableFuture<Void> replaceInvitations(UUID networkId, Set<UUID> players) {
    var snapshot = Set.copyOf(players);
    return database.write(
        dsl -> {
          var network =
              dsl.selectFrom(MECHANICS_STARGATE_NETWORK)
                  .where(MECHANICS_STARGATE_NETWORK.ID.eq(networkId.toString()))
                  .fetchOne();
          if (network == null || !network.getKind().equals("private")) {
            throw new IllegalStateException("invitations require a private network: " + networkId);
          }
          dsl.deleteFrom(MECHANICS_STARGATE_INVITE)
              .where(MECHANICS_STARGATE_INVITE.NETWORK_ID.eq(networkId.toString()))
              .execute();
          for (var player : snapshot) {
            dsl.insertInto(MECHANICS_STARGATE_INVITE)
                .set(MECHANICS_STARGATE_INVITE.NETWORK_ID, networkId.toString())
                .set(MECHANICS_STARGATE_INVITE.PLAYER_ID, player.toString())
                .execute();
          }
          return null;
        });
  }

  @Override
  public CompletableFuture<Void> createGate(Stargate gate) {
    return database.write(
        dsl -> {
          var row = dsl.newRecord(MECHANICS_STARGATE_GATE);
          row.setId(gate.id().toString());
          row.setNetworkId(gate.networkId().toString());
          row.setName(gate.name());
          row.setNameKey(key(gate.name()));
          row.setOwnerId(gate.ownerId().toString());
          row.setWorldId(gate.worldId().toString());
          row.setSignX(gate.sign().x());
          row.setSignY(gate.sign().y());
          row.setSignZ(gate.sign().z());
          row.setOriginX(gate.frame().origin().x());
          row.setOriginY(gate.frame().origin().y());
          row.setOriginZ(gate.frame().origin().z());
          row.setAcross(gate.frame().across().name());
          row.store();
          return null;
        });
  }

  @Override
  public CompletableFuture<Boolean> deleteGate(UUID id) {
    return database.write(
        dsl ->
            dsl.deleteFrom(MECHANICS_STARGATE_GATE)
                    .where(MECHANICS_STARGATE_GATE.ID.eq(id.toString()))
                    .execute()
                == 1);
  }

  private static String key(String name) {
    return name.toLowerCase(Locale.ROOT);
  }

  private static StargateNetwork network(
      MechanicsStargateNetworkRecord row, java.util.Map<UUID, Set<UUID>> invitations) {
    var id = UUID.fromString(row.getId());
    var invited = invitations.getOrDefault(id, Set.of());
    NetworkAccess access =
        switch (row.getKind()) {
          case "public" -> new NetworkAccess.Public();
          case "private" -> new NetworkAccess.Private(UUID.fromString(row.getOwnerId()), invited);
          case "town" -> new NetworkAccess.Town(UUID.fromString(row.getTownId()));
          default ->
              throw new IllegalStateException("unknown Stargate network kind: " + row.getKind());
        };
    if (!(access instanceof NetworkAccess.Private) && !invited.isEmpty()) {
      throw new IllegalStateException("invitations on non-private Stargate network " + id);
    }
    return new StargateNetwork(id, row.getName(), access);
  }

  private static Stargate gate(MechanicsStargateGateRecord row) {
    return new Stargate(
        UUID.fromString(row.getId()),
        UUID.fromString(row.getNetworkId()),
        row.getName(),
        UUID.fromString(row.getOwnerId()),
        UUID.fromString(row.getWorldId()),
        new Pos(row.getSignX(), row.getSignY(), row.getSignZ()),
        new StargateFrame(
            new Pos(row.getOriginX(), row.getOriginY(), row.getOriginZ()),
            Direction.valueOf(row.getAcross())));
  }
}
