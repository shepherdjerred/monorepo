package sjer.red.openai.excelsheet;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExcelSheetP1Test {
    private ExcelSheetP1 sheet;

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
        sheet = new ExcelSheetP1();
    }

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
        assertEquals(8, sheet.getCell("C1"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("C1"), "65d1b15b"));
    }
}
