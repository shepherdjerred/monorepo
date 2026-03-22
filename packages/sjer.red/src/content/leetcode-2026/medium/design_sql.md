---
title: "Design SQL"
date: 2026-03-22Z-0700
leetcode: true
---

## Problem

## Solution

completed in 18 minutes

```java
class SQL {

    class Table {
        int autoincrement = 1;
        int columns;
        Map<Integer, List<String>> rows = new HashMap<>();

        Table(int columns) {
            this.columns = columns;
        }
    }

    Map<String, Table> tables = new HashMap<>();

    public SQL(List<String> names, List<Integer> columns) {
        for (int i = 0; i < names.size(); i++) {
            var t = new Table(columns.get(i));
            tables.put(names.get(i),t);
        }
    }
    
    public boolean ins(String name, List<String> row) {
        if (!tables.containsKey(name)) {
            return false;
        }

        var t = tables.get(name);

        if (t.columns != row.size()) {
            return false;
        }

        t.rows.put(t.autoincrement, row);
        t.autoincrement += 1;
        return true;
    }
    
    public void rmv(String name, int rowId) {
        if (!tables.containsKey(name)) {
            return;
        }

        var t = tables.get(name);
        t.rows.remove(rowId);
    }
    
    public String sel(String name, int rowId, int columnId) {
        if (!tables.containsKey(name)) {
            return "<null>";
        }
        var t = tables.get(name);
        if (!t.rows.containsKey(rowId)) {
            return "<null>";
        }
        if (columnId > t.columns) {
            return "<null>";
        }
        return t.rows.get(rowId).get(columnId - 1);
    }
    
    public List<String> exp(String name) {
        if (!tables.containsKey(name)) {
            return List.of();
        }
        var t = tables.get(name);
        return t.rows.entrySet().stream()
          .map(entry -> entry.getKey() + "," + String.join(",", entry.getValue()))
          .collect(Collectors.toList());
    }
}

/**
 * Your SQL object will be instantiated and called as such:
 * SQL obj = new SQL(names, columns);
 * boolean param_1 = obj.ins(name,row);
 * obj.rmv(name,rowId);
 * String param_3 = obj.sel(name,rowId,columnId);
 * List<String> param_4 = obj.exp(name);
 */
```
