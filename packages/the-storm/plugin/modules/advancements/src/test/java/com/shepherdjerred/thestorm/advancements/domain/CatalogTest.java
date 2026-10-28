package com.shepherdjerred.thestorm.advancements.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.gson.JsonParser;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Objects;
import org.junit.jupiter.api.Test;

final class CatalogTest {

  @Test
  void theDatapackMatchesTheCatalog() throws IOException {
    var folder = advancementFolder();
    var files = new ArrayList<String>();
    try (var walk = Files.walk(folder)) {
      walk.filter(path -> path.toString().endsWith(".json"))
          .forEach(path -> files.add(folder.relativize(path).toString().replace(".json", "")));
    }
    assertThat(files)
        .containsExactlyInAnyOrderElementsOf(
            Catalog.all().stream().map(AdvancementDef::path).toList());

    var roots =
        Catalog.all().stream().filter(AdvancementDef::root).map(AdvancementDef::path).toList();
    assertThat(roots)
        .containsExactly("a_survival", "b_tracks", "c_skills", "d_spells", "e_arena", "f_search");

    for (var def : Catalog.all()) {
      var json =
          JsonParser.parseString(Files.readString(folder.resolve(def.path() + ".json")))
              .getAsJsonObject();
      var display = json.getAsJsonObject("display");
      assertThat(display.get("title").getAsString()).isEqualTo(def.title());
      assertThat(display.get("description").getAsString()).isEqualTo(def.description());
      assertThat(display.getAsJsonObject("icon").get("id").getAsString()).isEqualTo(def.icon());
      assertThat(display.get("announce_to_chat").getAsBoolean()).isEqualTo(!def.root());
      assertThat(display.get("show_toast").getAsBoolean()).isEqualTo(!def.root());
      assertThat(json.get("sends_telemetry_event").getAsBoolean()).isFalse();
      if (def.root()) {
        assertThat(json.has("parent")).isFalse();
        assertThat(display.get("background").getAsString()).isEqualTo(def.background());
        assertThat(
                json.getAsJsonObject("criteria")
                    .getAsJsonObject("tick")
                    .get("trigger")
                    .getAsString())
            .isEqualTo("minecraft:tick");
      } else {
        var parent = "thestorm:" + def.parent();
        assertThat(json.get("parent").getAsString()).isEqualTo(parent);
        assertThat(display.get("frame").getAsString()).isEqualTo("task");
        assertThat(json.getAsJsonObject("criteria").keySet()).containsExactly("done");
        assertThat(
                json.getAsJsonObject("criteria")
                    .getAsJsonObject("done")
                    .get("trigger")
                    .getAsString())
            .isEqualTo("minecraft:impossible");
        assertThat(def.tab()).isEqualTo(tab(Objects.requireNonNull(def.parent())));
      }
    }
  }

  @Test
  void everySpellSkillAndTrackHasItsChain() {
    assertThat(
            Catalog.all().stream()
                .map(AdvancementDef::path)
                .filter(path -> path.startsWith("d_spells/") && !path.equals("d_spells/first"))
                .map(path -> path.substring("d_spells/".length())))
        .containsExactlyInAnyOrder(
            java.util.Arrays.stream(SpellKind.values()).map(SpellKind::id).toArray(String[]::new));
    for (var skill : Skill.values()) {
      var id = skill.name().toLowerCase(Locale.ROOT);
      for (var level : new int[] {100, 250, 500, 1000}) {
        assertThat(paths()).contains("c_skills/" + id + "/" + level);
      }
    }
    for (var track : Track.values()) {
      for (var level = 1; level <= Track.MAX_LEVEL; level++) {
        assertThat(paths()).contains("b_tracks/" + track.id() + "/" + level);
      }
    }
  }

  private static java.util.List<String> paths() {
    return Catalog.all().stream().map(AdvancementDef::path).toList();
  }

  private static String tab(String path) {
    var slash = path.indexOf('/');
    return slash < 0 ? path : path.substring(0, slash);
  }

  private static Path advancementFolder() throws IOException {
    var resource =
        Catalog.class.getResource(
            "/datapacks/quiet-iron-pick/data/thestorm/advancement/a_survival.json");
    if (resource == null) {
      throw new IOException("missing storm advancements");
    }
    try {
      return Path.of(resource.toURI()).getParent();
    } catch (java.net.URISyntaxException failure) {
      throw new IOException(failure);
    }
  }
}
