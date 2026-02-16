---
title: "Find if Path Exists in Graph"
date: 2024-08-08Z-0700
leetcode: true
---

## Problem

There is a bi-directional graph with n vertices, where each vertex is labeled from 0 to n - 1 (inclusive). The edges in the graph are represented as a 2D integer array edges, where each edges[i] = [ui, vi] denotes a bi-directional edge between vertex ui and vertex vi. Every vertex pair is connected by at most one edge, and no vertex has an edge to itself.

You want to determine if there is a valid path that exists from vertex source to vertex destination.

Given edges and the integers n, source, and destination, return true if there is a valid path from source to destination, or false otherwise.

Example 1:

```text
Input: n = 3, edges = [[0,1],[1,2],[2,0]], source = 0, destination = 2
Output: true
Explanation: There are two paths from vertex 0 to vertex 2:

- 0 → 1 → 2
- 0 → 2
```

Example 2:

```text
Input: n = 6, edges = [[0,1],[0,2],[3,5],[5,4],[4,3]], source = 0, destination = 5
Output: false
Explanation: There is no path from vertex 0 to vertex 5.
```

Constraints:

- 1 <= n <= 2 \* 105
- 0 <= edges.length <= 2 \* 105
- edges[i].length == 2
- 0 <= ui, vi <= n - 1
- ui != vi
- 0 <= source, destination <= n - 1
- There are no duplicate edges.
- There are no self edges.

## Solution

### Another Union Find

Disjoint set from memory.

```java
class Solution {
    int[] root;
    int[] rank;
    public boolean validPath(int n, int[][] edges, int source, int destination) {
        root = new int[n];
        rank = new int[n];

        for (int i = 0; i < n; i++) {
            root[i] = i;
            rank[i] = 1;
        }

        for (var e : edges) {
            union(e[0], e[1]);
        }

        return find(source) == find(destination);
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

### Union Find

```java
class Solution {
    int[] root;
    int[] rank;

    public boolean validPath(int n, int[][] edges, int source, int destination) {
        this.rank = new int[n];
        this.root = new int[n];

        for (var i = 0; i < n; i++) {
            this.root[i] = i;
            this.rank[i] = i;
        }

        for (var e : edges) {
            union(e[0], e[1]);
        }

        return find(source) == find(destination);
    }

    public int find(int x) {
        if (root[x] != x) {
            root[x] = find(root[x]);
        }
        return root[x];
    }

    public void union(int x, int y) {
        int rootX = find(x);
        int rootY = find(y);
        if (rootX != rootY) {
            if (rank[rootX] > rank[rootY]) {
                rootX ^= rootY;
                rootY ^= rootX;
                rootX ^= rootY;
            }
            root[rootX] = rootY;
            rank[rootY] += rank[rootX];
        }
    }
}
```

### Iterative DFS

```java
class Solution {
    public boolean validPath(int n, int[][] edges, int source, int destination) {
        var m = new boolean[n][n];
        var visited = new boolean[n];
        for (var e : edges) {
            m[e[0]][e[1]] = true;
            m[e[1]][e[0]] = true;
        }
        return dfs(m, n, source, destination, visited);
    }

    boolean dfs(boolean[][] m, int n, int source, int d, boolean[] visited) {
        var stack = new Stack<Integer>();
        stack.add(source);

        while (!stack.isEmpty()) {
            var s = stack.pop();

            if (s == d) {
                return true;
            }

            visited[s] = true;

            for (var i = 0; i < n; i++) {
                if (m[s][i] && !visited[i]) {
                    stack.add(i);
                }
            }
        }

        return false;
    }
}
```

### DFS

```java
class Solution {
    public boolean validPath(int n, int[][] edges, int source, int destination) {
        var m = new boolean[n][n];
        var visited = new boolean[n];
        for (var e : edges) {
            m[e[0]][e[1]] = true;
            m[e[1]][e[0]] = true;
        }
        return dfs(m, n, source, destination, visited);
    }

    boolean dfs(boolean[][] m, int n, int s, int d, boolean[] visited) {
        if (s == d) {
            return true;
        }

        if (visited[s]) {
            return false;
        } else {
            visited[s] = true;
        }

        // for each edge at this node, call dfs
        for (var i = 0; i < n; i++) {
            if (m[s][i] && dfs(m, n, i, d, visited)) {
                return true;
            }
        }

        return false;
    }
}
```
