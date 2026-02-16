---
title: "Minimum Spanning Tree"
date: 2024-08-09Z-0700
leetcode: true
---

## Question

There are n cities labeled from 1 to n. You are given the integer n and an array connections where connections[i] = [xi, yi, costi] indicates that the cost of connecting city xi and city yi (bidirectional connection) is costi.

Return the minimum cost to connect all the n cities such that there is at least one path between each pair of cities. If it is impossible to connect all the n cities, return -1,

The cost is the sum of the connections' costs used.

Example 1:

```text
Input: n = 3, connections = [[1,2,5],[1,3,6],[2,3,1]]
Output: 6
Explanation: Choosing any 2 edges will connect all cities so we choose the minimum 2.
```

Example 2:

```text
Input: n = 4, connections = [[1,2,3],[3,4,4]]
Output: -1
Explanation: There is no way to connect all cities even if all edges are used.
```

Constraints:

- 1 <= n <= 104
- 1 <= connections.length <= 104
- connections[i].length == 3
- 1 <= xi, yi <= n
- xi != yi
- 0 <= costi <= 105

## Solution

```java
class Solution {
    int[] rank;
    int[] root;

    public int minimumCost(int n, int[][] connections) {
        rank = new int[n + 1];
        root = new int[n + 1];

        for (var i = 0; i < n; i++) {
            rank[i] = 1;
            root[i] = i;
        }

        Arrays.sort(connections, (l, r) -> {
            return Integer.compare(l[2], r[2]);
        });

        var cost = 0;
        for (var c : connections) {
            if (find(c[0]) != find(c[1])) {
                cost += c[2];
                union(c[0], c[1]);
            }
        }

        for (var i = 1; i < n; i++) {
            if (find(i) != find(i -1)) {
                return -1;
            }
        }

        return cost;
    }

    void union(int x, int y) {
        var rootX = root[x];
        var rootY = root[y];
        if (rank[rootX] > rank[rootY]) {
            rootX ^= rootY;
            rootY ^= rootX;
            rootX ^= rootY;
        }
        root[rootX] = rootY;
        rank[rootY] += rank[rootX];
    }

    int find(int x) {
        if (root[x] != x) {
            root[x] = find(root[x]);
        }
        return root[x];
    }
}
```
