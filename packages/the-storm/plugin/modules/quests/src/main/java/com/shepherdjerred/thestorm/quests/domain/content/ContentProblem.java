package com.shepherdjerred.thestorm.quests.domain.content;

/**
 * Why quest content was rejected.
 *
 * @param source the file, such as {@code quests/spawn.yml}
 * @param path where in it, such as {@code quests.a-blacksmiths-task.stages.gather}
 * @param message what is wrong
 */
public record ContentProblem(String source, String path, String message) {

  @Override
  public String toString() {
    return path.isEmpty() ? source + ": " + message : source + " at " + path + ": " + message;
  }
}
