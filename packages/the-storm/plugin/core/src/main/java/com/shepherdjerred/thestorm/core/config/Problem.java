package com.shepherdjerred.thestorm.core.config;

/**
 * One reason a configuration or content file was rejected.
 *
 * @param source the file or logical source that was parsed
 * @param path the location inside the document, such as {@code quests[2].reward}, or empty for the
 *     whole document
 * @param message what is wrong
 */
public record Problem(String source, String path, String message) {

  @Override
  public String toString() {
    return path.isEmpty() ? source + ": " + message : source + " at " + path + ": " + message;
  }
}
