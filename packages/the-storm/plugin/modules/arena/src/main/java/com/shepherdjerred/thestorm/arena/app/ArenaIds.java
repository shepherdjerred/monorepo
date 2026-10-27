package com.shepherdjerred.thestorm.arena.app;

import java.util.List;

/** {@link ArenaCatalog} over the ids loaded with the module. */
public record ArenaIds(List<String> ids) implements ArenaCatalog {

  public ArenaIds {
    ids = List.copyOf(ids);
  }
}
