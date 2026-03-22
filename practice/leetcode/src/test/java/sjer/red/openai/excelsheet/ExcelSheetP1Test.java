package sjer.red.openai.excelsheet;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

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
        assertTrue(v(sheet.getCell("A1"), "73475cb4"));
    }

    @Test
    void scenario_A2() {
        sheet.setCell("A1", 10);
        sheet.setCell("B1", 20);
        sheet.setCellFormula("C1", "=A1+B1");
        assertTrue(v(sheet.getCell("C1"), "624b60c5"));
    }

    @Test
    void scenario_A3() {
        sheet.setCell("A1", 100);
        sheet.setCellFormula("B1", "=A1-37");
        assertTrue(v(sheet.getCell("B1"), "da4ea2a5"));
    }

    @Test
    void scenario_A4() {
        sheet.setCell("A1", 7);
        sheet.setCell("B1", 6);
        sheet.setCellFormula("C1", "=A1*B1");
        assertTrue(v(sheet.getCell("C1"), "73475cb4"));
    }

    @Test
    void scenario_A5() {
        sheet.setCell("A1", 100);
        sheet.setCellFormula("B1", "=A1/3");
        assertTrue(v(sheet.getCell("B1"), "c6f3ac57"));
    }

    @Test
    void scenario_A6_chain() {
        sheet.setCell("A1", 5);
        sheet.setCellFormula("B1", "=A1+3");
        sheet.setCellFormula("C1", "=B1*2");
        assertTrue(v(sheet.getCell("C1"), "b17ef6d1"));
    }

    @Test
    void scenario_A7_update_propagation() {
        sheet.setCell("A1", 5);
        sheet.setCell("B1", 3);
        sheet.setCellFormula("C1", "=A1+B1");
        assertEquals(8, sheet.getCell("C1"));
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("C1"), "3fdba35f"));
    }

    @Test
    void scenario_A8_literal_operands() {
        sheet.setCellFormula("A1", "=5+3");
        assertTrue(v(sheet.getCell("A1"), "2c624232"));
    }

    @Test
    void scenario_A9_division_by_zero() {
        sheet.setCell("A1", 0);
        sheet.setCellFormula("B1", "=10/A1");
        assertThrows(ArithmeticException.class, () -> sheet.getCell("B1"));
    }

    @Test
    void scenario_A10_negative_values() {
        sheet.setCell("A1", -5);
        sheet.setCell("B1", 3);
        sheet.setCellFormula("C1", "=A1+B1");
        assertTrue(v(sheet.getCell("C1"), "cf3bae39"));
    }

    @Test
    void scenario_A11_subtraction_negative_result() {
        sheet.setCell("A1", 3);
        sheet.setCellFormula("B1", "=A1-10");
        assertTrue(v(sheet.getCell("B1"), "a770d327"));
    }

    @Test
    void scenario_A12_get_unset_cell() {
        System.out.println();
        assertTrue(v(sheet.getCell("Z99"), "5feceb66"));
    }

    @Test
    void scenario_A13_overwrite_value() {
        sheet.setCell("A1", 5);
        sheet.setCell("A1", 10);
        assertTrue(v(sheet.getCell("A1"), "4a44dc15"));
    }

    @Test
    void scenario_A14_same_cell_twice_in_formula() {
        sheet.setCell("A1", 7);
        sheet.setCellFormula("B1", "=A1+A1");
        assertTrue(v(sheet.getCell("B1"), "8527a891"));
    }

    @Test
    void scenario_A15_multi_digit_cell_names() {
        sheet.setCell("A10", 42);
        sheet.setCellFormula("B1", "=A10+1");
        assertTrue(v(sheet.getCell("B1"), "44cb730c"));
    }

    @Test
    void scenario_A16_formula_referencing_unset_cell() {
        sheet.setCellFormula("B1", "=A1+5");
        assertTrue(v(sheet.getCell("B1"), "ef2d127d"));
    }
}
