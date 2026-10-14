package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import java.util.UUID;
import org.bukkit.attribute.Attribute;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.attribute.AttributeInstanceMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Supplies the vanilla 26.2 fall attributes absent from MockBukkit's default player registry. */
public final class TraversalPlayerMock extends PlayerMock {
  public TraversalPlayerMock(ServerMock server, String name) {
    this(server, name, UUID.randomUUID());
    server.addPlayer(this);
  }

  public TraversalPlayerMock(ServerMock server, String name, UUID id) {
    super(server, name, id);
    // net.minecraft.world.entity.ai.attributes.Attributes defines these defaults as 3 and 1.
    attributes.put(
        Attribute.SAFE_FALL_DISTANCE, new AttributeInstanceMock(Attribute.SAFE_FALL_DISTANCE, 3));
    attributes.put(
        Attribute.FALL_DAMAGE_MULTIPLIER,
        new AttributeInstanceMock(Attribute.FALL_DAMAGE_MULTIPLIER, 1));
  }
}
