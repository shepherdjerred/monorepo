import { parse, ParseError } from "../parse";
import * as ast from "../ast";
import should = require("should");

describe("parsing", () => {

  describe("text and basic comments", () => {

    it("should parse a single text bloc", () => {
      let text = "this is a single [text] bloc";
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [text])
      );
    })

    it("should allow multi-line blocs", () => {
      let text = "this is a\nmulti-line\n\ntext bloc\n";
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [text])
      );
    })

    it("should ignore comment blocs", () => {
      let text = "there is [[# a\n#multi-line#\n comment #]] in [[#this#]] bloc\n";
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          "there is ",
          " in ",
          " bloc\n"
        ])
      )
    })

    it("should give an error on incomplete comments", () => {
      let text = "this text has a [[# incomplete comment bloc ]]";
      parse.bind(null, text, "fee.bloc").should.throw(ParseError, {
        fileName: "fee.bloc",
        lineNumber: 1,
        charNumber: "this text has a ".length + 1,
        message: "Unterminated comment"
      })
    })

    it("should throw on invalid blocs", () => {
      let text = "big [[frickin}} whoops";
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: "big [[frickin".length + 1,
        message: "Unexpected character in bloc"
      })
    })
  });

  describe("basic data", () => {
    it("should parse a bloc with undefined", () => {
      let text = `[[undefined]]`;
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1}, ast.Undefined({line: 1, char: 3}))
        ])
      );
    })

    it("should parse a bloc with null", () => {
      let text = `[[null]]`;
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1}, ast.Null({line: 1, char: 3}))
        ])
      );
    })

    it("should parse a bloc with a boolean", () => {
      for (let value of [true, false]) {
        let text = `[[${value}]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1}, ast.Boolean({line: 1, char: 3}, value))
          ])
        );
      }
    })

    it("should parse a bloc with a number", () => {
      for (let value of [0, 1, 3.14, 0.834, 123e123, 321e-321]) {
        let text = `[[${value}]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1}, ast.Number({line: 1, char: 3}, value))
          ])
        );
      }
    })

    it("should parse a bloc with a string", () => {
      for (let value of ["hello", "", "hello\t\\there\ngoodbye", "[[whoops]]"]) {
        let text = `[[${JSON.stringify(value)}]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1}, ast.String({line: 1, char: 3}, value))
          ])
        );
      }
    })

    it("should parse a bloc with an identifier", () => {
      for (let value of ["x", "abc123", "hello_there", "_GoOdBye_37"]) {
        let text = `[[${value}]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1}, ast.Identifier({line: 1, char: 3}, value))
          ])
        );
      }
    })

    it("should parse a bloc with an array construction", () => {
      let text = '[[[1, 2, 3, ["a", "b", "c"], 4, 5, []]]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1}, ast.ArrayConstruction({line: 1, char: 3}, [
            ast.Number({line: 1, char: 4}, 1),
            ast.Number({line: 1, char: 7}, 2),
            ast.Number({line: 1, char: 10}, 3),
            ast.ArrayConstruction({line: 1, char: 13}, [
              ast.String({line: 1, char: 14}, "a"),
              ast.String({line: 1, char: 19}, "b"),
              ast.String({line: 1, char: 24}, "c"),
            ]),
            ast.Number({line: 1, char: 30}, 4),
            ast.Number({line: 1, char: 33}, 5),
            ast.ArrayConstruction({line: 1, char: 36}, [])
          ])),
        ])
      );
    })

    it("should parse a bloc with an object construction", () => {
      let text = '[[{abc: 1, def: "z", ghi: {jkl: 2}, mno: {}}]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1}, ast.ObjectConstruction({line: 1, char: 3}, {
            abc: ast.Number({line: 1, char: 9}, 1),
            def: ast.String({line: 1, char: 17}, "z"),
            ghi: ast.ObjectConstruction({line: 1, char: 27}, {
              jkl: ast.Number({line: 1, char: 33}, 2)
            }),
            mno: ast.ObjectConstruction({line: 1, char: 42}, { })
          }))
        ])
      );
    })

    it("should parse multiple blocs", () => {
      let text = 'Hello, [["Fred"]]!\n[[#\nwhatever\n#]]\nYou owe $[[3.5e2]].\n[[\ndone]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          "Hello, ",
          ast.Bloc({line: 1, char: 8}, ast.String({line: 1, char: 10}, "Fred")),
          "!\n",
          "\nYou owe $",
          ast.Bloc({line: 5, char: 10}, ast.Number({line: 5, char: 12}, 3.5e2)),
          ".\n",
          ast.Bloc({line: 6, char: 1}, ast.Identifier({line: 7, char: 1}, "done"))
        ])
      );
    })

  });

  describe("expressions", () => {

    it("should parse a function call", () => {
      let text = '[[greeting()]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.Application({line: 1, char: 11},
              ast.Identifier({line: 1, char: 3}, "greeting"),
              []
            ))
        ])
      );
    })

    it("should parse a function call with an argument", () => {
      let text = '[[greeting("Joe")]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.Application({line: 1, char: 11},
              ast.Identifier({line: 1, char: 3}, "greeting"),
              [ ast.String({line: 1, char: 12}, "Joe") ]
            ))
        ])
      );
    })

    it("should parse a function call with multiple arguments", () => {
      let text = '[[repeat(5, ", ", greeting)]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.Application(
              {line: 1, char: 9},
              ast.Identifier({line: 1, char: 3}, "repeat"),
              [ ast.Number({line: 1, char: 10}, 5),
                ast.String({line: 1, char: 13}, ", "),
                ast.Identifier({line: 1, char: 19}, "greeting")
              ]
            ))
        ])
      );
    })

    it("should parse a property", () => {
      let text = '[[fee.fie]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.Property({line: 1, char: 6},
              ast.Identifier({line: 1, char: 3}, "fee"),
              ast.Identifier({line: 1, char: 7}, "fie")
            )
          )
        ])
      );
    })

    it("should parse an index", () => {
      let text = '[[fee["abc"]]]';
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.Index({line: 1, char: 6},
              ast.Identifier({line: 1, char: 3}, "fee"),
              ast.String({line: 1, char: 7}, "abc")
            )
          )
        ])
      );
    })

    it("should parse unary operators", () => {
      let text = "[[!x]][[ -x]][[ +x]]";
      let result = parse(text);
      should(result).deepEqual(
        ast.Template({line: 1, char: 1}, undefined, [
          ast.Bloc({line: 1, char: 1},
            ast.UnaryOperation({line: 1, char: 3}, "!",
              ast.Identifier({line: 1, char: 4}, "x")
            )
          ),
          ast.Bloc({line: 1, char: 7},
            ast.UnaryOperation({line: 1, char: 10}, "-",
              ast.Identifier({line: 1, char: 11}, "x")
            )
          ),
          ast.Bloc({line: 1, char: 14},
            ast.UnaryOperation({line: 1, char: 17}, "+",
              ast.Identifier({line: 1, char: 18}, "x")
            )
          )
        ])
      );
    })

    it("should parse binary operators", () => {
      for (let op of ["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "&&", "||", "|"]) {
        let text = `[[x${op}1]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1},
              ast.BinaryOperation({line: 1, char: 4},
                ast.Identifier({line: 1, char: 3}, "x"),
                op,
                ast.Number({line: 1, char: 4 + op.length}, 1)
              )
            )
          ])
        );
      }
    })

    it("should parse binary operators as left-associative", () => {
      for (let op of (["+", "<", "!="])) {
        let text = `[[w ${op} x ${op} y ${op} z]]`;
        let result = parse(text);
        should(result).deepEqual(
          ast.Template({line: 1, char: 1}, undefined, [
            ast.Bloc({line: 1, char: 1},
              ast.BinaryOperation({line: 1, char: 11 + 2*op.length},
                ast.BinaryOperation({line: 1, char: 8 + op.length},
                  ast.BinaryOperation({line: 1, char: 5},
                    ast.Identifier({line: 1, char: 3}, "w"),
                    op,
                    ast.Identifier({line: 1, char: 6 + op.length}, "x")
                  ),
                  op,
                  ast.Identifier({line: 1, char: 9 + 2*op.length}, "y")
                ),
                op,
                ast.Identifier({line: 1, char: 12 + 3*op.length}, "z")
              )
            )
          ])
        );
      }
    })

    it("should parse binary operators using precedence", () => {
      let text = "[[a * b + c / d == 3 && e > f == true]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.BinaryOperation({line: 1, char: 22},
            ast.BinaryOperation({line: 1, char: 17},
              ast.BinaryOperation({line: 1, char: 9},
                ast.BinaryOperation({line: 1, char: 5},
                  ast.Identifier({line: 1, char: 3}, "a"),
                  "*",
                  ast.Identifier({line: 1, char: 7}, "b")
                ),
                "+",
                ast.BinaryOperation({line: 1, char : 13},
                  ast.Identifier({line: 1, char: 11}, "c"),
                  "/",
                  ast.Identifier({line: 1, char: 15}, "d")
                )
              ),
              "==",
              ast.Number({line: 1, char: 20}, 3)
            ),
            "&&",
            ast.BinaryOperation({line: 1, char: 31},
              ast.BinaryOperation({line: 1, char: 27},
                ast.Identifier({line: 1, char: 25}, "e"),
                ">",
                ast.Identifier({line: 1, char: 29}, "f")
              ),
              "==",
              ast.Boolean({line: 1, char: 34}, true)
            )
          )
        )
      ]));
    })

    it("should parse nested expressions", () => {
      let text = '[[w / ((a + b) * (y + z))]]';
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.BinaryOperation({line: 1, char: 5},
            ast.Identifier({line: 1, char: 3}, "w"),
            "/",
            ast.BinaryOperation({line: 1, char: 16},
              ast.BinaryOperation({line: 1, char: 11},
                ast.Identifier({line: 1, char: 9}, "a"),
                "+",
                ast.Identifier({line: 1, char: 13}, "b")
              ),
              "*",
              ast.BinaryOperation({line: 1, char: 21},
                ast.Identifier({line: 1, char: 19}, "y"),
                "+",
                ast.Identifier({line: 1, char: 23}, "z")
              )
            )
          )
        )
      ]));
    })
  });

  describe("bloc templates", () => {

    it("should parse opening and closing blocs", () => {
      let text = "Hello [[+big]]bad[[-big]] world";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        "Hello ",
        ast.Bloc({line: 1, char: 7},
          ast.Identifier({line: 1, char: 10}, "big"),
          ast.Template({line: 1, char: 15}, undefined, [
            "bad"
          ])
        ),
        " world"
      ]));
    })

    it("should parse nested blocs", () => {
      let text = "[[+one]][[+two]]hello[[-two]][[-one]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "one"),
          ast.Template({line: 1, char: 9}, undefined, [
            ast.Bloc({line: 1, char: 9},
              ast.Identifier({line: 1, char: 12}, "two"),
              ast.Template({line: 1, char: 17}, undefined, [
                "hello"
              ])
            )
          ])
        ),
      ]));
    })

    it("should throw on missing closing bloc", () => {
      let text = "[[+one]][[+two]]hello[[-one]]";
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: "[[+one]][[+two]]hello[[-".length + 1,
        message: "Expected [[-two]]"
      });
      text = "[[+one]]";
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: "[[+one]]".length + 1,
        message: "Expected [[-one]]"
      });
    })

    it("should parse an implicit closing bloc", () => {
      let text = "[[+one]]abc[[*two]]def[[*three]]ghi[[-one]]jkl[[*four]]mno";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "one"),
          ast.Template({line: 1, char: 9}, undefined, [
            "abc",
            ast.Bloc({line: 1, char: 12},
              ast.Identifier({line: 1, char: 15}, "two"),
              ast.Template({line: 1, char: 20}, undefined, [
                "def",
                ast.Bloc({line: 1, char: 23},
                  ast.Identifier({line: 1, char: 26}, "three"),
                  ast.Template({line: 1, char: 33}, undefined, [
                    "ghi"
                  ])
                )
              ])
            ),
          ])
        ),
        "jkl",
        ast.Bloc({line: 1, char: 47},
          ast.Identifier({line: 1, char: 50}, "four"),
          ast.Template({line: 1, char: 56}, undefined, [
            "mno"
          ])
        )
      ]));
    })

    it("should parse template local param list", () => {
      let text = "[[+foo -> x, y, z]][[-foo]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "foo"),
          ast.Template({line: 1, char: 20},
            ast.TemplateParamList({line: 1, char: 8}, "local", [
            ast.Identifier({line: 1, char: 11}, "x"),
            ast.Identifier({line: 1, char: 14}, "y"),
            ast.Identifier({line: 1, char: 17}, "z"),
          ]), [])
        )
      ]));
    })

    it("should parse template global param list", () => {
      let text = "[[+foo => a, b, c]][[-foo]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "foo"),
          ast.Template({line: 1, char: 20},
            ast.TemplateParamList({line: 1, char: 8}, "global", [
            ast.Identifier({line: 1, char: 11}, "a"),
            ast.Identifier({line: 1, char: 14}, "b"),
            ast.Identifier({line: 1, char: 17}, "c"),
          ]), [])
        )
      ]));
    })

    it("should parse param list for root bloc", () => {
      let text = "[[*template -> x, y]]\nhello";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 2, char: 1},
        ast.TemplateParamList({line: 1, char: 13}, "local", [
          ast.Identifier({line: 1, char: 16}, "x"),
          ast.Identifier({line: 1, char: 19}, "y")
        ]),
        [ "hello" ]
      ))
    })

    it("should not allow parameters on empty blocs", () => {
      let text = "[[foo -> a, b, c]]";
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: 7,
        message: "Only opening blocs can have parameters"
      })
    })

    it("should ignore lines with only opening blocs", () => {
      let text = "abc\n  \n  [[+foo]]  \n  def[[-foo]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        "abc\n  \n",
        ast.Bloc({line: 3, char: 3},
          ast.Identifier({line: 3, char: 6}, "foo"),
          ast.Template({line: 4, char: 1}, undefined, [
              "  def"
          ])
        )
      ]))
    })

    it("should ignore lines with only closing blocs", () => {
      let text = "[[+foo]]abc\n  \n  [[-foo]]  \n  def"
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "foo"),
          ast.Template({line: 1, char: 9}, undefined, [
              "abc\n  \n"
          ])
        ),
        "  def"
      ]))
    })

  });

  describe("bloc properties", () => {

    it("should parse a bloc property", () => {
      let text = "[[+bing]][[pi: 3.14]][[-bing]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "bing"),
          ast.Template({line: 1, char: 10}, undefined, []),
          [ ast.Definition({line: 1, char: 10},
              ast.Identifier({line: 1, char: 12}, "pi"),
              ast.Number({line: 1, char: 16}, 3.14)
            )
          ]
        )
      ]));
    })

    it("should parse a bloc template property", () => {
      let text = "[[+bing]]hello[[+:bang]]goodbye[[-bang]][[-bing]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "bing"),
          ast.Template({line: 1, char: 10}, undefined, [ "hello" ]),
          [ ast.Definition({line: 1, char: 15},
              ast.Identifier({line: 1, char: 19}, "bang"),
              undefined,
              ast.Template({line: 1, char: 25}, undefined, [ "goodbye" ])
            )
          ]
        )
      ]));
    })

    it("should parse a bloc template property with parameters", () => {
      let text = "[[+bing]]hello[[+:bang -> m, n, o]]goodbye[[-bang]][[-bing]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "bing"),
          ast.Template({line: 1, char: 10}, undefined, [ "hello" ]),
          [ ast.Definition({line: 1, char: 15},
              ast.Identifier({line: 1, char: 19}, "bang"),
              undefined,
              ast.Template({line: 1, char: 36},
                ast.TemplateParamList({line: 1, char: 24}, "local", [
                  ast.Identifier({line: 1, char: 27}, "m"),
                  ast.Identifier({line: 1, char: 30}, "n"),
                  ast.Identifier({line: 1, char: 33}, "o")
                ]),
                [ "goodbye" ]
              )
            )
          ]
        )
      ]));
    })

    it("should parse multiple bloc properties", () => {
      let text = '[[+bing]][[x: 7]][[y: "zxc"]][[*:z]]zip[[-bing]]';
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "bing"),
          ast.Template({line: 1, char: 10}, undefined, []),
          [ ast.Definition({line: 1, char: 10},
              ast.Identifier({line: 1, char: 12}, "x"),
              ast.Number({line: 1, char: 15}, 7)
            ),
            ast.Definition({line: 1, char: 18},
              ast.Identifier({line: 1, char: 20}, "y"),
              ast.String({line: 1, char: 23}, "zxc")
            ),
            ast.Definition({line: 1, char: 30},
              ast.Identifier({line: 1, char: 34}, "z"),
              undefined,
              ast.Template({line: 1, char: 37}, undefined, [ "zip" ])
            )
          ]
        )
      ]));
    })

    it("should parse special else-if syntax", () => {
      let text = `[[+fee]]mno[[*:a b -> c]]xyz[[-fee]]`
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "fee"),
          ast.Template({line: 1, char: 9}, undefined, [ "mno" ]),
          [
            ast.Definition({line: 1, char: 12},
              ast.Identifier({line: 1, char: 16}, "a"),
              undefined,
              ast.Template({line: 1, char: 26}, undefined, [
                ast.Bloc({line: 1, char: 12},
                  ast.Identifier({line: 1, char: 18}, "b"),
                  ast.Template({line: 1, char: 26},
                    ast.TemplateParamList({line: 1, char: 20}, "local", [
                      ast.Identifier({line: 1, char: 23}, "c")
                    ]),
                    [ "xyz" ]
                  )
                )
              ])
            )
          ]
        )
      ]))
    })

    it("should not allow properties in the root bloc", () => {
      let text = 'hello [[pi: 3.14]] there';
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: 7,
        message: "Root bloc may not contain properties"
      })
    })

    it("should not allow properties inside properties", () => {
      let text = "[[+foo]][[*:fie]]hello[[pi: 3.14]][[-foo]]";
      parse.bind(null, text).should.throw(ParseError, {
        lineNumber: 1,
        charNumber: 23,
        message: "Bloc property may not contain nested properties"
      })
    })

    it("should ignore lines with only properties", () => {
      let text = "[[+foo]]abc  \n  [[pi: 3.14]]  \n  def[[-foo]]";
      let result = parse(text);
      should(result).deepEqual(ast.Template({line: 1, char: 1}, undefined, [
        ast.Bloc({line: 1, char: 1},
          ast.Identifier({line: 1, char: 4}, "foo"),
          ast.Template({line: 1, char: 9}, undefined, [
            "abc  \n",
            "  def"
          ]),
          [ ast.Definition({line: 2, char: 3},
              ast.Identifier({line: 2, char: 5}, "pi"),
              ast.Number({line: 2, char: 9}, 3.14)
          ) ]
        )
      ]))
    })

  })
});
