package com.shepherdjerred.thestorm.messages.domain;

import java.util.List;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The templates one kind of death draws from.
 *
 * @param templates never empty
 */
public record TemplatePool(List<Template> templates) {

  public TemplatePool {
    templates = List.copyOf(templates);
    if (templates.isEmpty()) {
      throw new IllegalArgumentException("a death message list must not be empty");
    }
  }

  /** Parses each source line as a template. */
  public static TemplatePool parse(List<String> sources) {
    return new TemplatePool(sources.stream().map(Template::parse).toList());
  }

  /** A uniformly random template. */
  public Template pick(RandomGenerator random) {
    return templates.get(random.nextInt(templates.size()));
  }

  /**
   * Rejects templates that mention a name this kind of death cannot supply, such as {@code
   * {weapon}} for a fall.
   */
  void requireOnly(Set<Placeholder> allowed, String where) {
    for (var template : templates) {
      for (var placeholder : template.placeholders()) {
        if (!allowed.contains(placeholder)) {
          throw new IllegalArgumentException(
              where + " cannot use " + placeholder.token() + ": \"" + template.source() + "\"");
        }
      }
    }
  }
}
