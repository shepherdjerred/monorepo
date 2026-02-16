---
title: "Course Schedule"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1. You are given an array prerequisites where prerequisites[i] = [ai, bi] indicates that you must take course bi first if you want to take course ai.

- For example, the pair [0, 1], indicates that to take course 0 you have to first take course 1.

Return true if you can finish all courses. Otherwise, return false.

Example 1:

```text
Input: numCourses = 2, prerequisites = [[1,0]]
Output: true
Explanation: There are a total of 2 courses to take.
To take course 1 you should have finished course 0. So it is possible.
```

Example 2:

```text
Input: numCourses = 2, prerequisites = [[1,0],[0,1]]
Output: false
Explanation: There are a total of 2 courses to take.
To take course 1 you should have finished course 0, and to take course 0 you should also have finished course 1. So it is impossible.
```

Constraints:

- 1 <= numCourses <= 2000
- 0 <= prerequisites.length <= 5000
- prerequisites[i].length == 2
- 0 <= ai, bi < numCourses
- All the pairs prerequisites[i] are unique.

## Solution

### Another Topological Sort

```java
class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        var m = new boolean[numCourses][numCourses];
        var indegree = new int[numCourses];
        var s = new Stack<Integer>();

        for (var p : prerequisites) {
            m[p[0]][p[1]] = true;
            indegree[p[0]] += 1;
        }

        for (var i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) {
                s.push(i);
            }
        }

        var complete = 0;
        while (!s.isEmpty()) {
            var c = s.pop();
            complete += 1;
            for (var i = 0; i < numCourses; i++) {
                if (m[i][c]) {
                    indegree[i] -= 1;
                    if (indegree[i] == 0) {
                        s.push(i);
                    }
                }
            }
        }

        return complete == numCourses;
    }
}
```

### Recursive DFS

```java
class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        // using DFS
        var m = new boolean[numCourses][numCourses];
        var gVisited = new boolean[numCourses];
        var lVisited = new boolean[numCourses];

        for (var p : prerequisites) {
            m[p[0]][p[1]] = true;
        }

        for (var i = 0; i < numCourses; i++) {
            if (!dfs(i, numCourses, m, gVisited, lVisited)) {
                return false;
            }
        }

        return true;
    }

    public boolean dfs(int i, int n, boolean[][] m, boolean[] gVisited, boolean[] lVisited) {
        if (lVisited[i]) {
            return false;
        }

        if (gVisited[i]) {
            return true;
        }

        gVisited[i] = true;
        lVisited[i] = true;

        // loop over every course that this vertex has an edge to
        for (var x = 0; x < n; x++) {
            if (m[i][x]) {
                // perform a dfs on x
                if (!dfs(x, n, m, gVisited, lVisited)) {
                    return false;
                }
            }
        }

        lVisited[i] = false;
        return true;
    }
}
```

### Topological Sort

If the input can be topologically sorted (and thus that the input forms a DAG), then we know that the course schedule is possible.

First try!

```java
class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        var indegree = new int[numCourses];
        var matrix = new boolean[numCourses][numCourses];
        for (var pair : prerequisites) {
            var course = pair[0];
            var prereq = pair[1];
            indegree[course] += 1;
            matrix[course][prereq] = true;
        }

        var next = new Stack<Integer>();

        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) {
                next.push(i);
                // mark this node as complete
                indegree[i] = -1;
            }
        }

        while (!next.isEmpty()) {
            var c = next.pop();
            for (int i = 0; i < numCourses; i++) {
                if (matrix[i][c] == true) {
                    indegree[i] -= 1;
                    if (indegree[i] == 0) {
                        indegree[i] = -1;
                        next.push(i);
                    }
                }
            }
        }

        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] != -1) {
                return false;
            }
        }

        return true;
    }
}
```
