---
title: "Parallel Courses"
date: 2024-08-05Z-0700
leetcode: true
---

## Problem

You are given an integer n, which indicates that there are n courses labeled from 1 to n. You are also given an array relations where relations[i] = [prevCoursei, nextCoursei], representing a prerequisite relationship between course prevCoursei and course nextCoursei: course prevCoursei has to be taken before course nextCoursei.

In one semester, you can take any number of courses as long as you have taken all the prerequisites in the previous semester for the courses you are taking.

Return the minimum number of semesters needed to take all courses. If there is no way to take all the courses, return -1.

Example 1:

```text
Input: n = 3, relations = [[1,3],[2,3]]
Output: 2
Explanation: The figure above represents the given graph.
In the first semester, you can take courses 1 and 2.
In the second semester, you can take course 3.
```

Example 2:

```text
Input: n = 3, relations = [[1,2],[2,3],[3,1]]
Output: -1
Explanation: No course can be studied because they are prerequisites of each other.
```

Constraints:

- 1 <= n <= 5000
- 1 <= relations.length <= 5000
- relations[i].length == 2
- 1 <= prevCoursei, nextCoursei <= n
- prevCoursei != nextCoursei
- All the pairs [prevCoursei, nextCoursei] are unique.

## Solution

Using topological sort

```java
class Solution {
    public int minimumSemesters(int n, int[][] relations) {
        // topological sort
        // use an adjacency list
        var l = new ArrayList<List<Integer>>();
        var indegree = new int[n + 1];
        // one-indexing
        indegree[0] = -1;

        for (int i = 0; i < n + 1; i++) {
            l.add(new ArrayList<>());
        }

        for (var r : relations) {
            l.get(r[0]).add(r[1]);
            indegree[r[1]] += 1;
        }

        Queue<Integer> q = new LinkedList<Integer>();

        for (int i = 0; i < n + 1; i++) {
            if (indegree[i] == 0) {
                q.offer(i);
            }
        }

        var i = q.size();
        var semesters = 0;
        var count = 0;
        while (!q.isEmpty()) {
            semesters += 1;
            while (i > 0) {
                i -= 1;
                count += 1;
                var curr = q.poll();
                indegree[curr] = -1;
                for (var child : l.get(curr)) {
                    indegree[child] -= 1;
                    if (indegree[child] == 0) {
                        q.offer(child);
                    }
                }
            }
            i = q.size();
        }

        if (count != n) {
            return -1;
        }

        return semesters;
    }
}
```
