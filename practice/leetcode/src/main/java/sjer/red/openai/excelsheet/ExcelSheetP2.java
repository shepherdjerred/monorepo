package sjer.red.openai.excelsheet;

/**
 * PROBLEM: Excel Sheet / Spreadsheet
 * <p>
 * PART 2: O(1) getCell
 * - Optimize so getCell is O(1) — return a cached value, no recomputation
 * - When setCell is called, proactively update all dependent downstream cells
 * - Build and maintain a dependency graph (reverse edges: who depends on me?)
 * - setCell/setCellFormula may be slower, but getCell must be constant time
 * <p>
 * Examples:
 * setCell("A1", 1)
 * setCellFormula("B1", "=A1+1")
 * setCellFormula("C1", "=B1+1")
 * setCellFormula("D1", "=C1+1")
 * getCell("D1")  → 4   // returned in O(1), no DFS
 * setCell("A1", 100)
 * getCell("D1")  → 103 // all downstream cells updated when A1 changed
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~30-40 minutes)
 */
public class ExcelSheetP2 {

    public ExcelSheetP2() {
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
