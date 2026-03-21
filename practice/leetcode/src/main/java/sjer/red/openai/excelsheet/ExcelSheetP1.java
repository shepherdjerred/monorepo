package sjer.red.openai.excelsheet;

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

    public ExcelSheetP1() {
        // TODO: initialize data structures
    }

    /**
     * Set a cell to an integer value.
     */
    public void setCell(String cell, int value) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Set a cell to a formula string (e.g. "=A1+B2").
     */
    public void setCellFormula(String cell, String formula) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Get the computed value of a cell.
     * Recompute via DFS each time.
     */
    public int getCell(String cell) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
