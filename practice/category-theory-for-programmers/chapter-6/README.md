# Simple Algebraic Data Types

### 1. Show the isomorphism between Maybe a and Either () a.
### 2. Implement Shape in C++ or Java as an interface and create two classes: Circle and Rect. Implement area as a virtual function.

Here’s a sum type defined in Haskell:
```haskell
    data Shape = Circle Float
               | Rect Float Float
```


    When we want to define a function like area that acts on a Shape, we do it by pattern matching on the two constructors:

```haskell
    area :: Shape -> Float
    area (Circle r) = pi * r * r
    area (Rect d h) = d * h
```
    
### 3. Continuing with the previous example: We can easily add a new function circ that calculates the circumference of a Shape. We can do it without touching the definition of Shape:
```haskell
    circ :: Shape -> Float
    circ (Circle r) = 2.0 * pi * r
    circ (Rect d h) = 2.0 * (d + h)
```

### 4. Add circ to your C++ or Java implementation. What parts of the original code did you have to touch?
### 5. Continuing further: Add a new shape, Square, to Shape and make all the necessary updates. What code did you have to touch in Haskell vs. C++ or Java? (Even if you’re not a Haskell programmer, the modifications should be pretty obvious.)
### 6. Show that a + a = 2 * a holds for types (up to isomorphism). Remember that 2 corresponds to Bool, according to our translation table.
