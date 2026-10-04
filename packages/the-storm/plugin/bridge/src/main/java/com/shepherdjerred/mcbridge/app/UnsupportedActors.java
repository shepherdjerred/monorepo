package com.shepherdjerred.mcbridge.app;

import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.domain.ActorName;
import com.shepherdjerred.mcbridge.domain.ActorRequests;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;

/** Actors on a server without Citizens: every route fails loudly with {@code unsupported}. */
public final class UnsupportedActors implements Actors {
  /** The message every actor route answers with. */
  public static final String MESSAGE =
      "Citizens is not installed on this server, so it has no test actors (/v1/actors needs the"
          + " Citizens plugin; /v1/info lists capabilities)";

  private static BridgeException unsupported() {
    return new BridgeException(ErrorCode.UNSUPPORTED, MESSAGE);
  }

  @Override
  public boolean supported() {
    return false;
  }

  @Override
  public JsonObject spawn(ActorRequests.Spawn spawn) {
    throw unsupported();
  }

  @Override
  public JsonObject list() {
    throw unsupported();
  }

  @Override
  public JsonObject observe(ActorName name) {
    throw unsupported();
  }

  @Override
  public JsonObject remove(ActorName name) {
    throw unsupported();
  }

  @Override
  public JsonObject goTo(ActorName name, ActorRequests.Goto request) {
    throw unsupported();
  }

  @Override
  public JsonObject look(ActorName name, BlockPos pos) {
    throw unsupported();
  }

  @Override
  public JsonObject equip(ActorName name, ActorRequests.Equip equip) {
    throw unsupported();
  }

  @Override
  public JsonObject command(ActorName name, String command) {
    throw unsupported();
  }

  @Override
  public JsonObject chat(ActorName name, ActorRequests.Chat chat) {
    throw unsupported();
  }

  @Override
  public JsonObject breakBlock(ActorName name, BlockPos pos) {
    throw unsupported();
  }

  @Override
  public JsonObject place(ActorName name, BlockPos pos, String blockState) {
    throw unsupported();
  }

  @Override
  public JsonObject use(ActorName name, BlockPos pos) {
    throw unsupported();
  }

  @Override
  public JsonObject attack(ActorName name, ActorRequests.AttackTarget target) {
    throw unsupported();
  }

  @Override
  public void shutdown() {
    // Nothing was spawned.
  }
}
