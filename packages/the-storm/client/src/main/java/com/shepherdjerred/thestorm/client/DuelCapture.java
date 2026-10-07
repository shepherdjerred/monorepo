package com.shepherdjerred.thestorm.client;

import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * Bounded, session-owned native duel clock journal; sealing performs disk I/O off the client
 * thread.
 */
final class DuelCapture implements AutoCloseable {
  record Status(String name, String state, int markers, String error, String receipt) {}

  record Packet(DuelMarker marker) implements CustomPacketPayload {
    static final Type<Packet> TYPE = new Type<>(Identifier.parse(DuelMarker.CHANNEL));
    static final StreamCodec<RegistryFriendlyByteBuf, Packet> CODEC =
        StreamCodec.ofMember(Packet::write, Packet::read);

    @Override
    public Type<Packet> type() {
      return TYPE;
    }

    private void write(RegistryFriendlyByteBuf buffer) {
      buffer.writeBytes(marker.encode());
    }

    private static Packet read(RegistryFriendlyByteBuf buffer) {
      if (buffer.readableBytes() != DuelMarker.BYTES)
        throw new IllegalArgumentException("Invalid native duel clock payload size");
      var bytes = new byte[DuelMarker.BYTES];
      buffer.readBytes(bytes);
      return new Packet(DuelMarker.decode(bytes));
    }
  }

  private final Path artifacts;
  private final ExecutorService io =
      Executors.newSingleThreadExecutor(Thread.ofVirtual().name("storm-duel-journal").factory());
  private @Nullable DuelTimeline timeline;
  private String name = "";
  private boolean sealed;
  private @Nullable CompletableFuture<Object> sealing;

  DuelCapture(Path artifacts) {
    this.artifacts = artifacts;
    PayloadTypeRegistry.clientboundPlay().register(Packet.TYPE, Packet.CODEC);
    ClientPlayNetworking.registerGlobalReceiver(
        Packet.TYPE,
        (payload, context) -> {
          var current = timeline;
          if (current != null && !sealed) current.accept(payload.marker(), System.nanoTime());
        });
  }

  Status arm(JsonNode args) {
    Protocol.keys(args, Set.of("name", "seed", "side", "mode", "opponent"));
    if (timeline != null && !sealed)
      throw new IllegalStateException("Seal the previous duel clock before arming another");
    var previous = sealing;
    if (previous != null) {
      if (!previous.isDone())
        throw new IllegalStateException("Previous duel journal is still sealing");
      // Surface a failed exclusive write before replacing any of its in-memory evidence.
      previous.getNow(null);
    }
    var nextName = Protocol.text(args, "name", 80);
    if (!nextName.matches("[a-zA-Z0-9_-]+"))
      throw new IllegalArgumentException("Invalid duel journal name");
    var seed = args.required("seed");
    if (!seed.isIntegralNumber() || !seed.canConvertToLong())
      throw new IllegalArgumentException("Invalid duel seed");
    var expected =
        new DuelTimeline.Expected(
            seed.longValue(),
            Protocol.text(args, "side", 10),
            Protocol.text(args, "mode", 10),
            Protocol.text(args, "opponent", 30));
    timeline = new DuelTimeline(expected, System.nanoTime());
    name = nextName;
    sealed = false;
    sealing = null;
    return status();
  }

  Status status() {
    var current = java.util.Objects.requireNonNull(timeline, "No duel clock is armed");
    return new Status(
        name, sealState(current), current.count(), current.error(), file().toString());
  }

  private String sealState(DuelTimeline current) {
    if (!sealed) return current.state();
    var pending = java.util.Objects.requireNonNull(sealing, "Missing claimed duel seal");
    if (!pending.isDone()) return "SEALING";
    try {
      pending.getNow(null);
      return "SEALED";
    } catch (java.util.concurrent.CompletionException failure) {
      current.fail(failure.toString());
      return "FAILED";
    }
  }

  CompletableFuture<Object> seal() {
    var current = java.util.Objects.requireNonNull(timeline, "No duel clock is armed");
    if (sealed) throw new IllegalStateException("Duel clock is already sealed");
    if (!Set.of("TERMINAL", "FAILED").contains(current.state()))
      throw new IllegalStateException("Duel clock must be terminal or failed before sealing");
    var receipt = current.receipt();
    var destination = file();
    sealed = true;
    sealing =
        CompletableFuture.supplyAsync(
            () -> {
              try {
                Files.writeString(
                    destination,
                    Protocol.JSON.writeValueAsString(receipt) + "\n",
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
                return destination.toString();
              } catch (IOException failure) {
                throw new IllegalStateException(
                    "Cannot seal exclusive native duel clock receipt", failure);
              }
            },
            io);
    return sealing;
  }

  void cancel() {
    var current = timeline;
    if (current != null && !sealed && !current.state().equals("TERMINAL"))
      current.fail("Duel clock cancelled");
  }

  void tick(boolean ready) {
    var current = timeline;
    if (current != null && !sealed && !ready && !current.state().equals("TERMINAL"))
      current.fail("Native duel observer disconnected or stopped spectating");
  }

  private Path file() {
    return artifacts.resolve(name + "-duel-clock.json");
  }

  @Override
  public void close() {
    cancel();
    io.shutdown();
  }
}
