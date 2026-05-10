---
title: "Course Schedule II"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1. You are given an array prerequisites where prerequisites[i] = [ai, bi] indicates that you must take course bi first if you want to take course ai.

- For example, the pair [0, 1], indicates that to take course 0 you have to first take course 1.

Return the ordering of courses you should take to finish all courses. If there are many valid answers, return any of them. If it is impossible to finish all courses, return an empty array.

Example 1:

```text
Input: numCourses = 2, prerequisites = [[1,0]]
Output: [0,1]
Explanation: There are a total of 2 courses to take. To take course 1 you should have finished course 0. So the correct course order is [0,1].
```

Example 2:

```text
Input: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]
Output: [0,2,1,3]
Explanation: There are a total of 4 courses to take. To take course 3 you should have finished both courses 1 and 2. Both courses 1 and 2 should be taken after you finished course 0.
So one correct course order is [0,1,2,3]. Another correct ordering is [0,2,1,3].
```

Example 3:

```text
Input: numCourses = 1, prerequisites = []
Output: [0]
```

Constraints:

- 1 <= numCourses <= 2000
- 0 <= prerequisites.length <= numCourses \* (numCourses - 1)
- prerequisites[i].length == 2
- 0 <= ai, bi < numCourses
- ai != bi
- All the pairs [ai, bi] are distinct.

## Solution

Another topological sort!

My approach will be is essentially identical to course schedule #1.

```java
class Solution {
    public int[] findOrder(int numCourses, int[][] prerequisites) {
        var m = new boolean[numCourses][numCourses];
        var indegree = new int[numCourses];

        // fill out m
        for (var pair : prerequisites) {
            var course = pair[0];
            var prereq = pair[1];
            m[course][prereq] = true;
            indegree[course] += 1;
        }

        // seed the stack
        var s = new Stack<Integer>();
        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) {
                s.push(i);
                // mark as complete
                indegree[i] = -1;
            }
        }

        var i = 0;
        var order = new int[numCourses];
        while (!s.isEmpty()) {
            var c = s.pop();
            order[i] = c;
            i += 1;
            for (int n = 0; n < numCourses; n++) {
                if (m[n][c] == true) {
                    indegree[n] -= 1;
                    if (indegree[n] == 0) {
                        // mark as complete
                        indegree[n] = -1;
                        s.push(n);
                    }
                }
            }
        }

        if (i == numCourses) {
            return order;
        } else {
            return new int[0];
        }
    }
}
```
