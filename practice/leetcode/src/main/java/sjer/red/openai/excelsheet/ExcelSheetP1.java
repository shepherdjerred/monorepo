package sjer.red.openai.excelsheet;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.BiFunction;
import java.util.regex.Pattern;

/**
 * PROBLEM: Excel Sheet / Spreadsheet
 * <p>
 * PART 1: Basic Spreadsheet
 * - setCell(cell, value) — set a cell to an integer value
 * - setCellFormula(cell, formula) — set a cell to a formula referencing other cells
 * - getCell(cell) — compute and return the cell's integer value
 * - Formulas are strings like "=A1+B2" or "=A1+5"
 * - Support operators: +, -, *, / (integer division)
 * - Formula operands are either cell references (e.g. "A1") or integer literals
 * - getCell recomputes via DFS each time (real-time computation)
 * <p>
 * Examples:
 * setCell("A1", 5)
 * setCell("B1", 3)
 * setCellFormula("C1", "=A1+B1")
 * getCell("C1")  → 8
 * setCell("A1", 10)
 * getCell("C1")  → 13
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class ExcelSheetP1 {

    // representing all as a string is simplistic but probably works for most cases
    Map<String, String> cells = new HashMap<>();

    /**
     * Set a cell to an integer value.
     */
    public void setCell(String cell, int value) {
        cells.put(cell, String.valueOf(value));
    }

    /**
     * Set a cell to a formula string (e.g. "=A1+B2").
     */
    public void setCellFormula(String cell, String formula) {
        // perhaps would benefit from representing this in a structured way
        cells.put(cell, formula);
    }

    /**
     * Get the computed value of a cell.
     * Recompute via DFS each time.
     */
    public int getCell(String cell) {
        // first, grab the cell
        // if it does not have `=` as the first char, we are good
        // if it _does_, then we need to call `getCell` on the dependents and perform the operation
        // TODO:
        // how many operands/how complex? answer always binary with simple references
        // which operations are supported? answer +-/*
        // what about cycles? answer: ignore for now, see if the test cases care

        // if we get an invalid query, use 0
        var val = cells.get(cell);
        if (val == null && cell.matches("^[A-Z].*")) {
            return 0;
        } else if (val == null) {
            // try to interpret it as a number
            // this can happen when we're doing recursive calls
            return Integer.parseInt(cell);
        } else if (!val.startsWith("=")) {
            return Integer.parseInt(val);
        }

        var valCopy = val;
        Map<String, BiFunction<Integer, Integer, Integer>> operations = new HashMap<>();
        operations.put("+", (left, right) -> left + right);
        operations.put("-", (left, right) -> left - right);
        operations.put("/", (left, right) -> left / right);
        operations.put("*", (left, right) -> left * right);

        var operator = operations.keySet().stream().map(key -> {
            if (!valCopy.contains(key)) {
                return null;
            }
            return key;
        }).filter(Objects::nonNull).findFirst().orElseThrow();

        // we def have a formula
        // assume all formulas follow the shape =X[-+*/]Y
        val = val.replace("=", "");
        var split = val.split(Pattern.quote(operator));

        var left = split[0];
        var right = split[1];

        return operations.get(operator).apply(getCell(left), getCell(right));
    }
}
