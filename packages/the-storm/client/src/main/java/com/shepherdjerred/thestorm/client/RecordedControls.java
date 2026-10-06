package com.shepherdjerred.thestorm.client;

import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.event.client.player.ClientPreAttackCallback;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;

/** Sends controls once per client tick, independently of gameplay and the automation bridge. */
final class RecordedControls {
  private long sequence;
  private long observationTick = -1;
  private final Pulses pulses = new Pulses();

  /** Retains clicks released before the end-of-tick sample without consuming vanilla input. */
  static final class Pulses {
    private int pending;

    void attack() {
      pending |= 1;
    }

    void use() {
      pending |= 2;
    }

    int drain(boolean attackHeld, boolean useHeld) {
      var buttons = pending | (attackHeld ? 1 : 0) | (useHeld ? 2 : 0);
      pending = 0;
      return buttons;
    }
  }

  record Packet(
      long sequence,
      int keys,
      int yaw,
      int pitch,
      int buttons,
      int slot,
      boolean automated,
      long observationTick)
      implements CustomPacketPayload {
    static final Type<Packet> TYPE = new Type<>(Identifier.parse("thestorm:rwf_input"));
    static final StreamCodec<RegistryFriendlyByteBuf, Packet> CODEC =
        StreamCodec.ofMember(Packet::write, Packet::read);

    @Override
    public Type<Packet> type() {
      return TYPE;
    }

    private void write(RegistryFriendlyByteBuf buffer) {
      buffer.writeByte(1);
      buffer.writeLong(sequence);
      buffer.writeByte(keys);
      buffer.writeInt(yaw);
      buffer.writeInt(pitch);
      buffer.writeByte(buttons);
      buffer.writeByte(slot);
      buffer.writeByte(automated ? 1 : 0);
      buffer.writeLong(observationTick);
    }

    private static Packet read(RegistryFriendlyByteBuf buffer) {
      if (buffer.readableBytes() != 29 || buffer.readByte() != 1)
        throw new IllegalArgumentException("invalid control packet");
      return new Packet(
          buffer.readLong(),
          buffer.readUnsignedByte(),
          buffer.readInt(),
          buffer.readInt(),
          buffer.readUnsignedByte(),
          buffer.readUnsignedByte(),
          buffer.readByte() == 1,
          buffer.readLong());
    }
  }

  RecordedControls() {
    PayloadTypeRegistry.serverboundPlay().register(Packet.TYPE, Packet.CODEC);
    PayloadTypeRegistry.clientboundPlay().register(Observation.TYPE, Observation.CODEC);
    ClientPlayNetworking.registerGlobalReceiver(
        Observation.TYPE, (payload, context) -> observationTick = payload.tick());
    ClientPreAttackCallback.EVENT.register(
        (client, player, clicks) -> {
          pulses.attack();
          return false;
        });
    UseItemCallback.EVENT.register((player, level, hand) -> recordUse(player));
    UseBlockCallback.EVENT.register((player, level, hand, hit) -> recordUse(player));
    UseEntityCallback.EVENT.register((player, level, hand, entity, hit) -> recordUse(player));
  }

  private InteractionResult recordUse(Player player) {
    if (player instanceof LocalPlayer) pulses.use();
    return InteractionResult.PASS;
  }

  void tick(Minecraft client, boolean automated) {
    var player = client.player;
    var options = client.options;
    var buttons = pulses.drain(options.keyAttack.isDown(), options.keyUse.isDown());
    if (player == null || client.gui.screen() != null || !ClientPlayNetworking.canSend(Packet.TYPE))
      return;
    var keys =
        (options.keyUp.isDown() ? 1 : 0)
            | (options.keyDown.isDown() ? 2 : 0)
            | (options.keyLeft.isDown() ? 4 : 0)
            | (options.keyRight.isDown() ? 8 : 0)
            | (options.keyJump.isDown() ? 16 : 0)
            | (options.keyShift.isDown() ? 32 : 0)
            | (options.keySprint.isDown() ? 64 : 0);
    ClientPlayNetworking.send(
        new Packet(
            sequence++,
            keys,
            Math.floorMod(Math.round(player.getYRot() * 100), 36000),
            Math.round(Math.clamp(player.getXRot(), -90, 90) * 100),
            buttons,
            player.getInventory().getSelectedSlot(),
            automated,
            observationTick));
  }

  record Observation(long tick, java.util.List<Float> values) implements CustomPacketPayload {
    static final Type<Observation> TYPE = new Type<>(Identifier.parse("thestorm:rwf_observation"));
    static final StreamCodec<RegistryFriendlyByteBuf, Observation> CODEC =
        StreamCodec.ofMember(Observation::write, Observation::read);

    Observation {
      values = java.util.List.copyOf(values);
    }

    @Override
    public Type<Observation> type() {
      return TYPE;
    }

    private void write(RegistryFriendlyByteBuf buffer) {
      buffer.writeByte(1);
      buffer.writeLong(tick);
      buffer.writeShort(values.size());
      values.forEach(buffer::writeFloat);
    }

    private static Observation read(RegistryFriendlyByteBuf buffer) {
      if (buffer.readByte() != 1)
        throw new IllegalArgumentException("unknown observation protocol");
      var tick = buffer.readLong();
      var count = buffer.readUnsignedShort();
      if (tick < 0 || count < 1 || count > 256 || buffer.readableBytes() != count * 4)
        throw new IllegalArgumentException("invalid observation size");
      var values = new java.util.ArrayList<Float>();
      for (var i = 0; i < count; i++) {
        var value = buffer.readFloat();
        if (!Float.isFinite(value) || value < -1 || value > 1)
          throw new IllegalArgumentException("invalid observation value");
        values.add(value);
      }
      return new Observation(tick, values);
    }
  }
}
