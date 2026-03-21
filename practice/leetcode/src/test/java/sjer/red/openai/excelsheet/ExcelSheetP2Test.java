package sjer.red.openai.excelsheet;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExcelSheetP2Test {
    private ExcelSheetP2 sheet;

    private static boolean v(int val, String prefix) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(String.valueOf(val).getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(hash);
            return hex.startsWith(prefix);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        sheet = new ExcelSheetP2();
    }

    // P1 regression tests (A1-A7)

    @Test
    void scenario_A1() {
        sheet.setCell("A1", 42);
        assertTrue(v(sheet.getCell("A1"), "a1c0bfe4"));
    }

    @Test
    void scenario_A2() {
        sheet.setCell("A1", 10);
        sheet.setCell("B1", 20);
        sheet.setCellFormula("C1", "=A1+B1");
        assertTrue(v(sheet.getCell("C1"), "6ea9ab1b"));
    }

    @Test
    void scenario_A3() {
        sheet.setCell("A1", 100);
        sheet.setCellFormula("B1", "=A1-37");
        assertTrue(v(sheet.getCell("B1"), "ea5d2f1c"));
    }

    @Test
    void scenario_A4() {
        sheet.setCell("A1", 7);
        sheet.setCell("B1", 6);
        sheet.setCellFormula("C1", "=A1*B1");
        assertTrue(v(sheet.getCell("C1"), "a1c0bfe4"));
    }

    @Test
    void scenario_A5() {
        sheet.setCell("A1", 100);
        sheet.setCellFormula("B1", "=A1/3");
        assertTrue(v(sheet.getCell("B1"), "5f0b48b6"));
    }

    @Test
    void scenario_A6_chain() {
        sheet.setCell("A1", 5);
        sheet.setCellFormula("B1", "=A1+3");
        sheet.setCellFormula("C1", "=B1*2");
        assertTrue(v(sheet.getCell("C1"), "48449a14"));
    }

    @Test
    void scenario_A7_update_propagation() {
        sheet.setCell("A1", 5);
        sheet.setCell("B1", 3);
        sheet.setCellFormula("C1", "=A1+B1");
assertTrue(8 == sheet.getCell("C1"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("C1"), "65d1b15b"));
    }

    // P2 tests (B1-B2)

    @Test
    void scenario_B1_cached() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        sheet.setCellFormula("D1", "=C1+1");
        // After setting, all should be pre-computed
        long start = System.nanoTime();
        for (int i = 0; i < 10000; i++) {
            sheet.getCell("D1");
        }
        long elapsed = System.nanoTime() - start;
        assertTrue(v(sheet.getCell("D1"), "687ce02e"));
        // If O(1), 10K calls should be fast (< 50ms easily)
        assertTrue(elapsed < 100_000_000L, "getCell should be O(1) — took " + elapsed + "ns");
    }

    @Test
    void scenario_B2_deep_chain_update() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        sheet.setCellFormula("D1", "=C1+1");
        sheet.setCellFormula("E1", "=D1+1");
        sheet.setCell("A1", 100);
        assertTrue(v(sheet.getCell("E1"), "8f53e515"));
    }

    @Test
    void scenario_B3_fan_out_update() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=A1+2");
        sheet.setCellFormula("D1", "=A1+3");
        sheet.setCellFormula("E1", "=A1+4");
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("B1"), "4fc82b26"));
        assertTrue(v(sheet.getCell("C1"), "6b51d431"));
        assertTrue(v(sheet.getCell("D1"), "3fdba35f"));
        assertTrue(v(sheet.getCell("E1"), "8527a891"));
    }

    @Test
    void scenario_B4_overwrite_formula_with_plain_value() {
        sheet.setCell("A1", 5);
        sheet.setCellFormula("B1", "=A1+1");
        assertTrue(v(sheet.getCell("B1"), "e7f6c011"));
        sheet.setCell("B1", 99);
        assertTrue(v(sheet.getCell("B1"), "8c1f1046"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("B1"), "8c1f1046"));
    }

    @Test
    void scenario_B5_overwrite_plain_value_with_formula() {
        sheet.setCell("A1", 5);
        sheet.setCell("B1", 10);
        sheet.setCellFormula("B1", "=A1+1");
        assertTrue(v(sheet.getCell("B1"), "e7f6c011"));
        sheet.setCell("A1", 20);
        assertTrue(v(sheet.getCell("B1"), "6f4b6612"));
    }

    @Test
    void scenario_B6_diamond_dependency() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=A1+2");
        sheet.setCellFormula("D1", "=B1+C1");
        assertTrue(v(sheet.getCell("D1"), "ef2d127d"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("B1"), "4fc82b26"));
        assertTrue(v(sheet.getCell("C1"), "6b51d431"));
        assertTrue(v(sheet.getCell("D1"), "535fa30d"));
    }

    @Test
    void scenario_B7_wide_fan_out() {
        sheet.setCell("A1", 1);
        for (int i = 1; i <= 50; i++) {
            sheet.setCellFormula("B" + i, "=A1+" + i);
        }
        sheet.setCell("A1", 100);
        for (int i = 1; i <= 50; i++) {
            assertEquals(100 + i, sheet.getCell("B" + i));
        }
    }

    @Test
    void scenario_B8_remove_formula_breaks_dependency() {
        sheet.setCell("A1", 5);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        assertTrue(v(sheet.getCell("C1"), "7902699b"));
        sheet.setCell("B1", 99);
        assertTrue(v(sheet.getCell("B1"), "8c1f1046"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("B1"), "8c1f1046"));
        assertTrue(v(sheet.getCell("C1"), "ad573668"));
    }
}
