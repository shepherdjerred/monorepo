package sjer.red.openai;

/**
 * PROBLEM: Excel Sheet / Spreadsheet
 *
 * Implement a simple spreadsheet with cells that can contain values or formulas.
 *
 * PART 1:
 *   - setCell(cell, value) — set a cell to an integer value
 *   - setCell(cell, formula) — set a cell to a formula referencing other cells
 *   - getCell(cell) — compute and return the cell's integer value
 *   - Formulas are strings like "=A1+B2" or "=A1+5"
 *   - Support operators: +, -, *, / (integer division)
 *   - Formula operands are either cell references (e.g. "A1") or integer literals
 *   - getCell recomputes via DFS each time (real-time computation)
 *
 *   Examples:
 *     setCell("A1", 5)
 *     setCell("B1", 3)
 *     setCell("C1", "=A1+B1")
 *     getCell("C1")  → 8
 *     setCell("A1", 10)
 *     getCell("C1")  → 13
 *
 * PART 2:
 *   - Optimize so getCell is O(1)
 *   - When setCell is called, proactively update all dependent downstream cells
 *   - Build and maintain a dependency graph
 *
 * PART 3:
 *   - Detect circular dependencies (e.g. A1=B1, B1=A1)
 *   - Throw an exception if setCell would create a cycle
 *   - The cell should NOT be updated if a cycle is detected
 *
 * TIME TARGET: 45-60 minutes for all 3 parts
 */
public class ExcelSheet {

    public ExcelSheet() {
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
     * @throws IllegalArgumentException if this would create a circular dependency (Part 3)
     */
    public void setCellFormula(String cell, String formula) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Get the computed value of a cell.
     * Part 1: recompute via DFS
     * Part 2: return cached O(1) value
     */
    public int getCell(String cell) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
