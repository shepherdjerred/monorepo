---
title: "Task Scheduler"
date: 2024-08-12Z-0700
leetcode: true
---

## Problem

You are given an array of CPU tasks, each represented by letters A to Z, and a cooling time, n. Each cycle or interval allows the completion of one task. Tasks can be completed in any order, but there's a constraint: identical tasks must be separated by at least n intervals due to cooling time.

​Return the minimum number of intervals required to complete all tasks.

Example 1:

```text
Input: tasks = ["A","A","A","B","B","B"], n = 2
Output: 8
Explanation: A possible sequence is: A -> B -> idle -> A -> B -> idle -> A -> B.

After completing task A, you must wait two cycles before doing A again. The same applies to task B. In the 3rd interval, neither A nor B can be done, so you idle. By the 4th cycle, you can do A again as 2 intervals have passed.
```

Example 2:

```text
Input: tasks = ["A","C","A","B","D","B"], n = 1
Output: 6
Explanation: A possible sequence is: A -> B -> C -> D -> A -> B.

with a cooling interval of 1, you can repeat a task after just one other task.
```

Example 3:

```text
Input: tasks = ["A","A","A", "B","B","B"], n = 3
Output: 10
Explanation: A possible sequence is: A -> B -> idle -> idle -> A -> B -> idle -> idle -> A -> B.

There are only two types of tasks, A and B, which need to be separated by 3 intervals. This leads to idling twice between repetitions of these tasks.
```

Constraints:

- 1 <= tasks.length <= 104
- tasks[i] is an uppercase English letter.
- 0 <= n <= 100

## Solution

```java
class Solution {
    public int leastInterval(char[] tasks, int n) {
        // fill a pq with a counter of tasks -> freq
        var freq = new HashMap<Character, Integer>();

        for (var task : tasks) {
            freq.merge(task, 1, Integer::sum);
        }

        var pq = new PriorityQueue<Character>((l, r) -> {
            return Integer.compare(freq.get(r), freq.get(l));
        });

        for (var task : freq.keySet()) {
            pq.offer(task);
        }

        var steps = 0;

        // we'll put tasks here after we schedule them
        var q = new LinkedList<Character>();
        var done = 0;

        while (done < tasks.length) {
            // remove from the queue if possible
            if (q.size() > n) {
                var result = q.poll();
                // check if we were idling
                if (result != null) {
                    pq.offer(result);
                }
            }

            // if there's nothing schedulable left
            if (pq.isEmpty()) {
                // idle
                q.offer(null);
                steps += 1;
                continue;
            } else {
                // we can do some useful work
                var task = pq.poll();
                freq.compute(task, (k, v) -> v - 1);
                if (freq.get(task) > 0) {
                    q.offer(task);
                } else {
                    // we always need to put something back in the queue
                    q.offer(null);
                }
                steps += 1;
                done += 1;
            }
        };

        return steps;
    }
}
```
