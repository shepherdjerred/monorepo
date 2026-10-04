package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** A team in the match, by its stable name. */
public record TeamId(String value) {

  public TeamId {
    if (value.isBlank()) {
      throw new IllegalArgumentException("team id must not be blank");
    }
  }

  @Override
  public String toString() {
    return value;
  }
}
