package sjer.red.openai.excelsheet;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class ExcelSheetP3Test {
    private ExcelSheetP3 sheet;

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
        sheet = new ExcelSheetP3();
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

    // P2 regression tests (B1-B2)

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

    // P3 tests (C1-C3)

    @Test
    void scenario_C1_direct_cycle() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=B1+1"));
        // A1 should retain its original value
        assertTrue(v(sheet.getCell("A1"), "56b92da4"));
    }

    @Test
    void scenario_C2_self_reference() {
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=A1+1"));
    }

    @Test
    void scenario_C3_indirect_cycle() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=C1+1"));
    }

    @Test
    void scenario_C4_cycle_rollback_preserves_state() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=C1+1"));
        assertTrue(v(sheet.getCell("A1"), "6b86b273"));
        assertTrue(v(sheet.getCell("B1"), "d4735e3a"));
        assertTrue(v(sheet.getCell("C1"), "4e074085"));
    }

    @Test
    void scenario_C5_valid_formula_after_rejected_cycle() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=C1+1"));
        sheet.setCellFormula("A1", "=5+3");
        assertTrue(v(sheet.getCell("A1"), "2c624232"));
        assertTrue(v(sheet.getCell("B1"), "19581e27"));
        assertTrue(v(sheet.getCell("C1"), "4a44dc15"));
    }

    @Test
    void scenario_C6_longer_indirect_cycle() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        sheet.setCellFormula("C1", "=B1+1");
        sheet.setCellFormula("D1", "=C1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=D1+1"));
    }

    @Test
    void scenario_C7_breaking_cycle_path_allows_re_add() {
        sheet.setCell("A1", 1);
        sheet.setCellFormula("B1", "=A1+1");
        assertThrows(IllegalArgumentException.class, () ->
                sheet.setCellFormula("A1", "=B1+1"));
        sheet.setCell("B1", 99);
        sheet.setCellFormula("A1", "=B1+1");
        assertTrue(v(sheet.getCell("A1"), "ad573668"));
    }
}
