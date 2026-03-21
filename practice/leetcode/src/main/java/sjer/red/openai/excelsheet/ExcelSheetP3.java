package sjer.red.openai.excelsheet;

/**
 * PROBLEM: Excel Sheet / Spreadsheet
 * <p>
 * PART 3: Circular Dependency Detection
 * - Detect circular dependencies (e.g. A1=B1, B1=A1)
 * - Throw IllegalArgumentException if setCellFormula would create a cycle
 * - The cell should NOT be updated if a cycle is detected (rollback)
 * - Self-references count as cycles (e.g. A1 = "=A1+1")
 * <p>
 * Examples:
 * setCell("A1", 1)
 * setCellFormula("B1", "=A1+1")
 * setCellFormula("A1", "=B1+1")  → throws IllegalArgumentException
 * getCell("A1")  → 1  // unchanged, formula was rejected
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~45-60 minutes)
 */
public class ExcelSheetP3 {

    public ExcelSheetP3() {
        // TODO: initialize data structures
    }

    /**
     * Set a cell to an integer value.
     * Must propagate updates to all downstream dependents.
     */
    public void setCell(String cell, int value) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Set a cell to a formula string (e.g. "=A1+B2").
     * Must detect cycles and throw IllegalArgumentException if one exists.
     * Must NOT update the cell if a cycle is detected.
     * Must propagate updates to all downstream dependents.
     */
    public void setCellFormula(String cell, String formula) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Get the computed value of a cell.
     * Must be O(1) — return cached value.
     */
    public int getCell(String cell) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
