package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.AbstractArrow;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.ArrowMock;

/**
 * An arrow that has landed or is still flying. MockBukkit leaves {@link #isInBlock()} unimplemented
 * (it throws), so this mock answers it from what the test says.
 */
public class LandedArrowMock extends ArrowMock {
  private final boolean inBlock;

  /**
   * Registers an arrow at {@code at} with {@code pickup}, stuck in a block when {@code inBlock}.
   */
  public static LandedArrowMock add(
      ServerMock server, Location at, AbstractArrow.PickupStatus pickup, boolean inBlock) {
    var arrow = new LandedArrowMock(server, inBlock);
    arrow.setLocation(at);
    arrow.setPickupStatus(pickup);
    server.registerEntity(arrow);
    return arrow;
  }

  public LandedArrowMock(ServerMock server, boolean inBlock) {
    super(server, UUID.randomUUID());
    this.inBlock = inBlock;
  }

  @Override
  public boolean isInBlock() {
    return inBlock;
  }
}
