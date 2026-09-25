package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import java.util.List;
import java.util.Optional;

/** The loaded NPC content, replaced whole on {@code /npc reload}. Main thread. */
public final class NpcCatalog implements NpcDirectory {

  private Content content;

  public NpcCatalog(Content content) {
    this.content = content;
  }

  public Content content() {
    return content;
  }

  public void replace(Content replacement) {
    content = replacement;
  }

  @Override
  public Optional<NpcRef> find(String id) {
    return content.npc(id).map(NpcRef::of);
  }

  @Override
  public List<NpcRef> all() {
    return content.sortedNpcs().stream().map(NpcRef::of).toList();
  }
}
