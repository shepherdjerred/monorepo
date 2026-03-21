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

    // P1+P2 regression tests (must still pass)

    @BeforeEach
    void setUp() {
        sheet = new ExcelSheetP3();
    }

    @Test
    void scenario_A1() {
        sheet.setCell("A1", 42);
        assertTrue(v(sheet.getCell("A1"), "a1c0bfe4"));
    }

    @Test
    void scenario_A7_update_propagation() {
        sheet.setCell("A1", 5);
        sheet.setCell("B1", 3);
        sheet.setCellFormula("C1", "=A1+B1");
        assertEquals(8, sheet.getCell("C1"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("C1"), "65d1b15b"));
    }

    // P3 tests

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
}
