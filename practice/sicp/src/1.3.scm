(define (square x) (* x x))

(define (sum-square x y)
  (+
    (square x)
    (square y)))

(define (sum-square-largest x y z) 
  (cond
    ((and (>= x z) (>= y z)) (sum-square x y))  
    ((and (>= y x) (>= z x)) (sum-square y z))  
    ((and (>= z y) (>= x y)) (sum-square x z))))
