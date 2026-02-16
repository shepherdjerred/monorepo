---
title: "Redundant Connection"
date: 2024-08-09Z-0700
leetcode: true
---

## Problem

In this problem, a tree is an undirected graph that is connected and has no cycles.

You are given a graph that started as a tree with n nodes labeled from 1 to n, with one additional edge added. The added edge has two different vertices chosen from 1 to n, and was not an edge that already existed. The graph is represented as an array edges of length n where edges[i] = [ai, bi] indicates that there is an edge between nodes ai and bi in the graph.

Return an edge that can be removed so that the resulting graph is a tree of n nodes. If there are multiple answers, return the answer that occurs last in the input.

Example 1:

```text
Input: edges = [[1,2],[1,3],[2,3]]
Output: [2,3]
```

Example 2:

```text
Input: edges = [[1,2],[2,3],[3,4],[1,4],[1,5]]
Output: [1,4]
```

Constraints:

- n == edges.length
- 3 <= n <= 1000
- edges[i].length == 2
- 1 <= ai < bi <= edges.length
- ai != bi
- There are no repeated edges.
- The given graph is connected.

## Solution

### DFS

```java

```

### Union Find

```java
class Solution {
    int[] root;
    int[] rank;

    public int[] findRedundantConnection(int[][] edges) {
        root = new int[edges.length + 1];
        rank = new int[edges.length + 1];

        for (var i = 0; i < edges.length; i++) {
            root[i] = i;
            rank[i] = 1;
        }

        for (var e : edges) {
            if (find(e[0]) == find(e[1])) {
                return e;
            }
            union(e[0], e[1]);
        }

        return null;
    }

    int find(int x) {
        if (root[x] != x) {
            root[x] = find(root[x]);
        }
        return root[x];
    }

    void union(int x, int y) {
        var rootX = find(x);
        var rootY = find(y);

        if (rank[rootX] > rank[rootY]) {
            rootX ^= rootY;
            rootY ^= rootX;
            rootX ^= rootY;
        }

        root[rootX] = rootY;
        rank[rootY] += rank[rootX];
    }
}
```
