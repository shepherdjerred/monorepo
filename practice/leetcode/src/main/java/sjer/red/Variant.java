package sjer.red;

import java.util.*;

public class Variant {
  public static void main(String[] args) {
    System.out.println(solve(new String[][]{
        {"Red", "S"},
        {"Red", "M"},
        {"Red", "L"},
        {"Blue", "XS"},
        {"Blue", "S"},
        {"Blue", "L"}
    }));

    System.out.println(solve(new String[][]{
        {"Red", "XS"},
        {"Red", "M"},
        {"Red", "L"},
        {"Blue", "XS"},
        {"Blue", "S"},
        {"Blue", "L"}
    }));
  }

  public static List<List<String>> solve(String[][] input) {
    Map<String, Set<String>> colors = new HashMap<>();
    Map<String, Set<String>> sizes = new HashMap<>();

    Map<String, Integer> colorsIndegree = new HashMap<>();
    Map<String, Integer> sizesIndegree = new HashMap<>();

    String[] prev = null;

    for (var i = 0; i < input.length; i++) {
      var curr = input[i];

      colorsIndegree.putIfAbsent(curr[0], 0);
      sizesIndegree.putIfAbsent(curr[1], 0);

      // colors don't match
      if (prev != null && !curr[0].equals(prev[0])) {
        colorsIndegree.merge(curr[0], 1, Integer::sum);
        // link this color
        colors.compute(prev[0], (k, v) -> {
          if (v == null) {
            v = new HashSet<>();
          }
          v.add(curr[0]);
          return v;
        });
        prev = null;
      }

      // add an edge from the prev to this if possible
      if (prev != null) {
        sizesIndegree.merge(curr[1], 1, Integer::sum);
        sizes.compute(prev[1], (k, v) -> {
          if (v == null) {
            v = new HashSet<>();
          }
          v.add(curr[1]);
          return v;
        });
      }
      prev = curr;
    }

    // topological sort for both
    return List.of(
        sort(colors, colorsIndegree),
        sort(sizes, sizesIndegree)
    );
  }

  static boolean unique(Map<String, Set<String>> map) {
    return false;
  }

  static List<String> sort(Map<String, Set<String>> map, Map<String, Integer> indegree) {
    Stack<String> next = new Stack<>();
    for (var entry : indegree.entrySet()) {
      if (entry.getValue() == 0) {
        next.push(entry.getKey());
      }
    }

    List<String> answer = new ArrayList<>();
    while (!next.isEmpty()) {
      var curr = next.pop();
      answer.add(curr);
      // decrement the indegree of every node that this points t
      map.getOrDefault(curr,Set.of()).forEach((thing) -> {
        indegree.compute(thing, (k, v) -> {
          if (v == 1) {
            next.add(thing);
            return 0;
          }
          return v - 1;
        });
      });
    }

    return answer;
  }
}
