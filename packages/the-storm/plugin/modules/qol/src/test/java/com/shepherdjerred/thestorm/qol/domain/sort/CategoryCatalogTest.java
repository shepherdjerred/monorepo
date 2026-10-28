package com.shepherdjerred.thestorm.qol.domain.sort;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.qol.domain.sort.CategoryCatalog.Source;
import java.util.List;
import org.junit.jupiter.api.Test;

final class CategoryCatalogTest {

  @Test
  void theFirstCategoryWinsAndAStarOnlySitsAtAnEnd() {
    var catalog =
        CategoryCatalog.parse(
            List.of(
                new Source("weapons", "sticky=false\n*_sword\nbow\n"),
                new Source("food", "apple\n")));

    assertThat(catalog.place("minecraft:diamond_sword").category()).isZero();
    assertThat(catalog.place("bow").category()).isZero();
    assertThat(catalog.place("minecraft:apple").category()).isEqualTo(1);
    assertThat(catalog.place("minecraft:dirt").category()).isEqualTo(2);
  }

  @Test
  void aStarInTheMiddleIsRejected() {
    assertThatThrownBy(() -> CategoryCatalog.parse(List.of(new Source("bad", "a*b*c\n"))))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
