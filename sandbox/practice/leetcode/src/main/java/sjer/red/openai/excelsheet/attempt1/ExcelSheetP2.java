package sjer.red.openai.excelsheet.attempt1;

import java.util.*;
import java.util.function.BiFunction;
import java.util.regex.Pattern;

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
    // 30m in, just finished first pass
    // 54m in, passing most test cases. LOTS of edge cases here! jesus christ

    // stores RAW
    Map<String, String> cells = new HashMap<>();
    // stores CALCULATED
    Map<String, Integer> cache = new HashMap<>();

    // for a cell, who depends on this cell
    Map<String, Set<String>> deps = new HashMap<>();

    public void setCell(String cell, int value) {
        deps.putIfAbsent(cell, new HashSet<>());
        cells.put(cell, String.valueOf(value));
        cache.put(cell, value);

        // if we moved from formula -> int we need to remove anyone we said we depended on

        // who depends on me??? tell them to recalc!
        deps.get(cell).forEach(depCell -> {
            System.out.printf("Recalc %s BC OF %s", depCell, cell);
            cache.put(depCell, calcCell(depCell));
        });
    }

    public void setCellFormula(String cell, String formula) {
        deps.putIfAbsent(cell, new HashSet<>());
        // who do I now depend on?
        Set<String> newOperands = getOperands(formula).orElseThrow().toSet();

        // who did I previously depend on?
        Set<String> oldOperands;
        if (cells.containsKey(cell) && isFormula(cell)) {
            oldOperands = getOperands(cells.get(cell)).orElseThrow().toSet();
        } else {
            oldOperands = Set.of();
        }

        oldOperands.forEach(old -> {
            if (newOperands.contains(old)) {
                // ok, noop
            }
            // remove, not needed anymore
            System.out.printf("REMOVE DEP %s ON %s\n", cell, old);
            deps.get(old).remove(cell);
        });

        newOperands.forEach((newOp) -> {
            deps.putIfAbsent(newOp, new HashSet<>());
            // add new deps
            System.out.printf("NEW DEP %s ON %s\n", cell, newOp);
            deps.get(newOp).add(cell);
        });

        System.out.println(cells);
        System.out.println(cache);

        // store my pre-calculated value
        cells.put(cell, formula);
        cache.put(cell, calcCell(cell));

        // who depends on me??? tell them to recalc!
        deps.get(cell).forEach(depCell -> {
            System.out.printf("Recalc %s BC OF %s", depCell, cell);
            cache.put(depCell, calcCell(depCell));
        });

        // update those who depend on me
    }

    // So, the issue is that when we GET we must perform some calculation
    // we can pre-calculate on SET, though.
    // e.g. if a user puts =2+3 we can obviously pre-calc that
    // or, if a user puts =A+B we can pre-calc that, though we have to eval A+B on SET
    // the issue is, what is the user sets C=A+B and then changes A or B? we'd need to update all dependents (C)
    //
    // so, on SET we'd need to say: precalc this AND track any deps
    // and this could be multiple levels deep
    // C=A+B B=X+Y A=Z+X X=1 Y=2
    // so we'd need to say
    // C depends on A,B
    // B depends on X,Y
    // A depends on Z,X
    // transitively, C depends on X,Y,Z. we have made a DAG
    // ok so what we'd do is:
    // on SET X:
    // - update X
    // find everyone who depends on X (A, B)
    // SET A, B (or at least recalc)
    //
    // ADDITIONALLY
    // if any neew relationships were added, or relationships were removed, we must now track them
    // for example, if we set SET A to "2", then we'd  need to update C, and also update it so that Z, X are not tracked as dependencies of A, otherwise we would perform unneeded updates
    // so questions we need to answer:
    // - who depends on me?
    // - who do I depend on?
    //
    // pseudocode:
    /*
     * SET(var):
     *   if (deps(var).length > 0):
     *     for dep in var:
     *       deps.add(var, dep)
     *     for dep in deps(var):
     *       if dep not in var:
     *         remove
     *   value = calc(var)
     *   for all values that depend ON var (reverse mapping, essentially):
     *     calc()
     *
     * hardest part RN is going to be that reverse tracking bit
     */

    Operation getOperation(String expression) {
        Map<String, BiFunction<Integer, Integer, Integer>> operations = new HashMap<>();
        operations.put("+", (left, right) -> left + right);
        operations.put("-", (left, right) -> left - right);
        operations.put("/", (left, right) -> left / right);
        operations.put("*", (left, right) -> left * right);

        var operator = operations.keySet().stream().map(key -> {
            if (!expression.contains(key)) {
                return null;
            }
            return key;
        }).filter(Objects::nonNull).findFirst().orElseThrow();

        return new Operation(operator, operations.get(operator));
    }

    boolean isFormula(String cell) {
        return cell.startsWith("=");
    }

    Optional<Operands> getOperands(String expression) {
        if (!isFormula(expression)) {
            throw new IllegalArgumentException();
        }

        var operation = getOperation(expression);

        // we def have a formula
        // assume all formulas follow the shape =X[-+*/]Y
        expression = expression.replace("=", "");
        var split = expression.split(Pattern.quote(operation.operation));

        var left = split[0];
        var right = split[1];

        return Optional.of(new Operands(left, right));
    }

    int apply(String expression) {
        if (!isFormula(expression)) {
            throw new IllegalArgumentException();
        }

        var operation = getOperation(expression);
        var operands = getOperands(expression).orElseThrow();

        System.out.printf("%s %s %s%n", operation.operation, operands.left, operands.right);

        return operation.fn.apply(getCell(operands.left), getCell(operands.right));
    }

    int calcCell(String cell) {
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

        return apply(val);
    }

    /**
     * Get the computed value of a cell.
     * Recompute via DFS each time.
     */
    public int getCell(String cell) {
        var val = cache.get(cell);
        if (val == null) {
            // try to interpret it as a number
            // this can happen when we're doing recursive calls
            return Integer.parseInt(cell);
        }

        System.out.printf("%s %s\n", cell, val);

        return cache.get(cell);
    }

    record Operands(String left, String right) {
        Set<String> toSet() {
            return Set.of(left(), right());
        }
    }

    record Operation(String operation, BiFunction<Integer, Integer, Integer> fn) {
    }
}
