package com.shepherdjerred.mcbridge.app;

import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.domain.ActorName;
import com.shepherdjerred.mcbridge.domain.ActorRequests;
import com.shepherdjerred.mcbridge.domain.BlockPos;

/**
 * Harness test actors: server-side player NPCs the agent drives. Responses are the wire shapes of
 * the {@code /v1/actors} routes. Implemented by Citizens when it is installed, otherwise by {@link
 * UnsupportedActors}.
 */
public interface Actors {
  /** Whether actors can be spawned on this server ({@code citizens} capability). */
  boolean supported();

  JsonObject spawn(ActorRequests.Spawn spawn);

  JsonObject list();

  JsonObject observe(ActorName name);

  JsonObject remove(ActorName name);

  JsonObject goTo(ActorName name, ActorRequests.Goto request);

  JsonObject look(ActorName name, BlockPos pos);

  JsonObject equip(ActorName name, ActorRequests.Equip equip);

  JsonObject command(ActorName name, String command);

  JsonObject chat(ActorName name, ActorRequests.Chat chat);

  JsonObject breakBlock(ActorName name, BlockPos pos);

  JsonObject place(ActorName name, BlockPos pos, String blockState);

  JsonObject use(ActorName name, BlockPos pos);

  JsonObject attack(ActorName name, ActorRequests.AttackTarget target);

  /** Removes every actor; called when the bridge stops. Main thread only. */
  void shutdown();
}
