---
title: "Possible Bipartition"
date: 2024-08-14Z-0700
leetcode: true
---

## Problem

We want to split a group of n people (labeled from 1 to n) into two groups of any size. Each person may dislike some other people, and they should not go into the same group.

Given the integer n and the array dislikes where dislikes[i] = [ai, bi] indicates that the person labeled ai does not like the person labeled bi, return true if it is possible to split everyone into two groups in this way.

Example 1:

```text
Input: n = 4, dislikes = [[1,2],[1,3],[2,4]]
Output: true
Explanation: The first group has [1,4], and the second group has [2,3].
```

Example 2:

```text
Input: n = 3, dislikes = [[1,2],[1,3],[2,3]]
Output: false
Explanation: We need at least 3 groups to divide them. We cannot put them in two groups.
```

Constraints:

- 1 <= n <= 2000
- 0 <= dislikes.length <= 104
- dislikes[i].length == 2
- 1 <= ai < bi <= n
- All the pairs of dislikes are unique.

## Solution

```java
class Solution {
    int[] root;
    int[] rank;

    public boolean possibleBipartition(int n, int[][] dislikes) {
        // transform the input into an adjacency list
        var adj = new ArrayList<List<Integer>>();

        root = new int[n + 1];
        rank = new int[n + 1];

        for (var i = 0; i < n + 1; i++) {
            adj.add(new ArrayList<>());
            root[i] = i;
            rank[i] = 1;
        }

        for (var d : dislikes) {
            adj.get(d[0]).add(d[1]);
            adj.get(d[1]).add(d[0]);
        }

        for (var i = 0; i < n; i++) {
            var node = adj.get(i);

            for (var x = 0; x < node.size(); x++) {
                var neighbor = node.get(x);
                if (find(i) == find(neighbor)) {
                    return false;
                }
                union(node.get(0), neighbor);
            }
        }

        return true;
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
            //swap
            rootX ^= rootY;
            rootY ^= rootX;
            rootX ^= rootY;
        }
        rank[rootY] += rank[rootX];
        root[rootX] = rootY;
    }
}
```
