package com.shepherdjerred.thestorm.npcs.domain.content;

/**
 * One reason NPC content was rejected.
 *
 * @param source the file
 * @param path where in it, such as {@code npcs.stan.skin}
 * @param message what is wrong
 */
public record ContentProblem(String source, String path, String message) {

  @Override
  public String toString() {
    return path.isEmpty() ? source + ": " + message : source + " at " + path + ": " + message;
  }
}
