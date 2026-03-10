package sjer.red.from_2026;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class DesignSql {
    class Table {
        int increment;
        Map<Integer, Row> rows;
        int size;

        Table(int increment, Map<Integer, Row> rows, int size) {
            this.increment = increment;
            this.rows = rows;
            this.size = size;
        }
    }

    record Row(List<String> columns) {
    }

    Map<String, Table> tableMap = new HashMap<>();

    public DesignSql(List<String> names, List<Integer> columns) {
        for (int i = 0; i < names.size(); i++) {
            tableMap.put(names.get(i), new Table(1, new HashMap<>(), columns.get(i)));
        }
    }

    // insert a row
    // get table: constant time
    // increment: constant time, constant space
    // insert: constant, I don't think this is O(n) since we don't e.g. iterate over the columns
    public boolean ins(String name, List<String> row) {
        var table = tableMap.get(name);
        if (table == null || row.size() != table.size) {
            return false;
        }
        table.rows.put(table.increment, new Row(row));
        table.increment += 1;
        return true;
    }

    // remove a row
    // get table: constant
    // remove: constant
    public void rmv(String name, int rowId) {
        var table = tableMap.get(name);
        if (table == null) return;
        table.rows.remove(rowId);
    }

    // constant
    public String sel(String name, int rowId, int columnId) {
        var table = tableMap.get(name);
        if (table == null || columnId > table.size) return "<null>";
        var row = table.rows.get(rowId);
        if (row == null) return "<null>";
        return row.columns.get(columnId - 1);
    }

    // O(n)
    public List<String> exp(String name) {
        var table = tableMap.get(name);
         if (table == null) {
             return List.of();
         }
         return table.rows.entrySet().stream().map((entry) -> {
             return String.format("%s,%s", entry.getKey(), String.join(",", entry.getValue().columns));
         }).toList();
    }

    public static void main(String[] args) {

    }
}
