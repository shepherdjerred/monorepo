---
title: "Min Stack"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Design a stack that supports push, pop, top, and retrieving the minimum element in constant time.

Implement the MinStack class:

- MinStack() initializes the stack object.
- void push(int val) pushes the element val onto the stack.
- void pop() removes the element on the top of the stack.
- int top() gets the top element of the stack.
- int getMin() retrieves the minimum element in the stack.

You must implement a solution with O(1) time complexity for each function.

Example 1:

```text
Input
["MinStack","push","push","push","getMin","pop","top","getMin"]
[[],[-2],[0],[-3],[],[],[],[]]

Output
[null,null,null,null,-3,null,0,-2]

Explanation
MinStack minStack = new MinStack();
minStack.push(-2);
minStack.push(0);
minStack.push(-3);
minStack.getMin(); // return -3
minStack.pop();
minStack.top();    // return 0
minStack.getMin(); // return -2
```

Constraints:

- -231 <= val <= 231 - 1
- Methods pop, top and getMin operations will always be called on non-empty stacks.
- At most 3 \* 104 calls will be made to push, pop, top, and getMin.

## Solution

I know that we can implement a stack very easily with just a linked list. The problem is keeping track of the minimum element. My mind jumps immediately to a priority queue/min heap, but that won't meet the O(1) runtime requirement of the problem.

I think we can solve this by keeping a second stack with the minimum seen value. This works since stacks are LIFO and don't allow arbitrary inserts/removals.

```java
class MinStack {

    LinkedList<Integer> l;
    LinkedList<Integer> min;

    public MinStack() {
        l = new LinkedList<>();
        min = new LinkedList<>();
    }

    public void push(int val) {
        Optional<Integer> currentMin = Optional.empty();
        if (min.size() > 0) {
            currentMin = Optional.of(getMin());
        }

        l.push(val);

        if (currentMin.isPresent()) {
            min.push(Math.min(currentMin.get(), val));
        } else {
            min.push(val);
        }
    }

    public void pop() {
        l.pop();
        min.pop();
    }

    public int top() {
        return l.peek();
    }

    public int getMin() {
        return min.peek();
    }
}
```
