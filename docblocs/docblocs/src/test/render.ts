import { template, render, Helper } from "../render";
import * as should from "should";

describe("rendering", () => {

  describe("basic blocs", () => {

    it ("should leave plain text alone", () => {
      let text = "this is a single [text] bloc";
      return render(text).then(result => {
        should(result).be.a.String().equal(text);
      });
    })

    it("should ignore comments", () => {
      let text = "hello[[# abc\ndef #]]world";
      return render(text).then(result => {
        should(result).be.a.String().equal("helloworld");
      })
    })

    it("should render null", () => {
      let text = "watch out for [[null]] pointers";
      return render(text).then(result => {
        should(result).be.a.String().equal("watch out for  pointers");
      });
    });

    it("should render undefined", () => {
      let text = "this is not [[undefined]] behavior";
      return render(text).then(result => {
        should(result).be.a.String().equal("this is not  behavior");
      });
    })

    it("should render boolean literals", () => {
      let text = "How [[true]] it is!";
      return render(text).then(result => {
        should(result).be.a.String().equal("How true it is!");
      })
    })

    it("should render number literals", () => {
      let text = "Pi = [[3.14159]]";
      return render(text).then(result => {
        should(result).be.a.String().equal("Pi = 3.14159");
      })
    })

    it("should render string literals", () => {
      let text = 'Hello, [["world"]]!';
      return render(text).then(result => {
        should(result).be.a.String().equal("Hello, world!");
      })
    })

    it("should render identifiers", () => {
      let text = "Hello, [[name]]!";
      return render(text, { name: "Fred" }).then(result => {
        should(result).be.a.String().equal("Hello, Fred!");
      })
    })

    it("should render multiple blocs", () => {
      let text = '[[123]] [[x]] [["hello"]]';
      return render(text, { x: "???" }).then(result => {
        should(result).be.a.String().equal("123 ??? hello");
      })
    })
  })

  describe("expressions", () => {
    it("should evaluate unary operators", () => {
      let text = "[[ -3]] [[ -x]] [[!y]] [[ +5]]";
      let context = { x: 8, y: false };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("-3 -8 true 5");
      })
    })

    it("should evaluate binary operators", () => {
      let text = `[[13 + 5]]
[[13 - 5]]
[[13 * 5]]
[[13 / 5]]
[[13 % 5]]
[[13 == 5]] [[13 == 13]] [[13 == 25]]
[[13 != 5]] [[13 != 13]] [[13 != 25]]
[[13  < 5]] [[13  < 13]] [[13  < 25]]
[[13 <= 5]] [[13 <= 13]] [[13 <= 25]]
[[13  > 5]] [[13  > 13]] [[13  > 25]]
[[13 >= 5]] [[13 >= 13]] [[13 >= 25]]
[[true || true]] [[true || false]] [[false || false]]
[[true && true]] [[true && false]] [[false && false]]`;
      return render(text).then(result => {
        should(result).be.a.String().equal(`18
8
65
2.6
3
false true false
true false true
false false true
false true true
true false false
true true false
true true false
true false false`);
      })
    })

    it("should respect operator precedence", () => {
      let text = "[[3 + 4 * 5]] and [[3 - 4 - 5 > 0 == 7 * 6 > 6 * 7]]";
      return render(text).then(result => {
        should(result).be.a.String().equal("23 and true");
      })
    })

    it("should evaluate helpers with the | operator", () => {
      let text = "[[x | lc]]";
      let context = {
        x: template("Hello, [[y]] WORLD!"),
        y: "DEF",
        lc: (s: string) => s.toLowerCase()
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("hello, def world!");
      })
    })

    it("should evaluate properties", () => {
      let text = "Hello, [[user.stats.age]] year-old [[user.name]]";
      let context = {
        user: {
          name: "Fred",
          stats: { age: 50 }
        }
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Hello, 50 year-old Fred");
      })
    })

    it("should evalutate array indexes", () => {
      let text = "Hello [[name[0]]], [[name[1]]], and [[name[2]]]";
      let context = {
        name: [ "larry", "curly", "moe" ]
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Hello larry, curly, and moe");
      })
    })

    it("should evaluate function calls", () => {
      let text = "[[f()]]+[[g(3, 4)]]";
      let context = {
        f: () => 6,
        g: (x: number, y: number) => x + y
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("6+7");
      })
    })
  })

  describe("exceptions", () => {

    it("should yield exception messages", () => {
      let text = "[[fee()]]";
      let context = {
        fee: (x: any) => x.y
      }
      return render(text, context).then(result => {
        should(result).be.a.String().equal("TypeError: Cannot read property 'y' of undefined");
      })
    })

    it("should yield message for bad function call", () => {
      let text = "[[fee()]]";
      return render(text, context).then(result => {
        should(result).be.a.String().equal("TypeError: fee is not a function");
      })
    })

    it("should yield custom exception messages", () => {
      let text = "[[fee]]";
      let context = {
        fee: () => { throw new Error("Whoops!") }
      }
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Error: Whoops!");
      })
    })

  })

  describe("undefined", () => {

    it("should handle undefined identifiers", () => {
      let text = "Hello, [[name]]!";
      return render(text).then(result => {
        should(result).be.a.String().equal("Hello, !");
      });
    })

    it("should handle properties of undefined values", () => {
      let text = "-[[undefined.foo]]-[[null.foo]]-[[goo.foo]]-[[fee.fie.foe.fum]]-";
      return render(text, { goo: { }, fee: { fie: { } } }).then(result => {
        should(result).be.a.String().equal("-----");
      });
    })

    it("should handle indices of undefined values", () => {
      let text = "=[[undefined[3]]]=[[null[2]]]=[[goo[2]]]=[[fee[1][2][3]]]=";
      return render(text, { goo: [ ], fee: [[ ], [ ]] }).then(result => {
        should(result).be.a.String().equal("=====");
      })
    })

  })

  describe("helpers", () => {

    it("should call helpers", () => {
      let text = "[[fee]]";
      let context = { fee: () => "Hello, world" };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Hello, world");
      })
    })

    it("should call helpers from curried functions", () => {
      let text = "abc [[fee(3, 4)]] xyz";
      let context = { fee: (x: number, y: number) => (() => x + y) };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc 7 xyz");
      })
    })

    it("should pass the context to helpers", () => {
      let text = "[[fee]]";
      let context = { fee: (ctx: any) => ctx.fum, fum: "Howdy" };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Howdy");
      })
    })

    it("should pass the bloc dictionary to helpers", () => {
      let text = '[[+fee]][[fum: "Whatever"]][[-fee]]';
      let context = { fee: (ctx: any, bloc: any) => bloc.fum };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Whatever");
      })
    })

    it("should render a template as a helper", () => {
      let text = "[[fee]]";
      let context = {
        fee: template("abc [[3 + 4]] [[x]]"),
        x: "Zippity doo dah"
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc 7 Zippity doo dah");
      })
    })

    it("should allow blocs to refer to bloc dictionary using this", () => {
      let text = "[[+ 2 * this.pi * this.r]][[pi: 3.14159]][[r: 10]][[- 2 * this.pi * this.r]]";
      return render(text).then(result => {
        should(result).be.a.String().equal(String(3.14159*20));
      })
    })

    it("should allow templates to refer to containing bloc properties as bloc", () => {
      let text = '[[+fee]][[fum: "Hello, world!"]][[-fee]]';
      let context = { fee: template("abc [[bloc.fum]] xyz") };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc Hello, world! xyz");
      })
    })

  })

  describe("nested templates", () => {

    it("should store nested templates as contents", () => {
      let text = "[[+fee]]Bing [[x]] bong[[-fee]]";
      let context = {
        fee: (ctx: any, bloc: any) => bloc.contents({ x: "bang" })
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Bing bang bong");
      })
    })

    it("should allow templates to access bloc properties", () => {
      let text = '[[+this.contents]][[name: "Joe"]]Hello, [[bloc.name]][[-this.contents]]';
      return render(text).then(result => {
        should(result).be.a.String().equal("Hello, Joe");
      })
    })

    it("should allow templates to render bloc contents", () => {
      let text = "[[+fee]]Hello, [[name]][[-fee]]";
      let context = {
        name: "Fred",
        fee: template("<div>[[bloc.contents]]</div>")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("<div>Hello, Fred</div>");
      })
    })

    it("should allow templates to render bloc properties", () => {
      let text = "[[+fee]]abc[[*:fum]]xyz[[-fee]]";
      let context = {
        name: "Fred",
        fee: template("[[bloc.contents]]/[[bloc.fum]]")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc/xyz");
      })
    })
  })

  describe("template parameters", () => {

    it("should pass arguments to local template parameters", () => {
      let text = '[[*this.contents("fee", "fie") -> x, y]][[x]]*[[y]]';
      return render(text).then(result => {
        should(result).be.a.String().equal("fee*fie");
      })
    })

    it("should let helpers pass arguments to template parameters", () => {
      let text = "[[+fee -> x, y]][[x]]|[[y]]|[[z]][[-fee]]";
      let context = {
        fee: (ctx: any, bloc: any) => bloc.contents(7, 8)({ z: 9 })
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("7|8|9");
      })
    })

    it("should make parameters accessible by nested scopes", () => {
      let text = `[[*this.contents(22) -> x]][[x]]
[[*this.contents]][[x]]
[[*this.contents]][[x]]`;
      return render(text).then(result => {
        should(result).be.a.String().equal("22\n22\n22");
      })
    })

    it("should hide parameters once they go out of scope", () => {
      let text = `[[+this.contents(8) -> x]][[x]][[-this.contents]].[[x]].`;
      return render(text).then(result => {
        should(result).be.a.String().equal("8..");
      })
    })

    it("should implement nested scopes", () => {
      let text = `[[x]]
[[+this.contents(4) -> x]][[x]]
[[+this.contents(5) -> x]][[x]]
[[-this.contents]][[x]]
[[-this.contents]][[x]]`;
      return render(text, { x: 3 }).then(result => {
        should(result).be.a.String().equal("3\n4\n5\n4\n3")
      })
    })

    it("should make parameters accessible in templates passed to other templates", () => {
      let text = `[[+this.contents(15) -> x]]local1 = [[x]]
[[+fee]](local1 = [[x]])[[-fee]]
[[-this.contents]]global = [[x]]`;
      let context = {
        fee: template(`global = [[x]]
[[*this.contents(27, bloc.contents) -> x, y]]local2 = [[x]]
[[y]]`),
        x: 53
      }
      return render(text, context).then(result => {
        should(result).be.a.String().equal(`local1 = 15
global = 53
local2 = 27
(local1 = 15)
global = 53`);
      })
    })

    it("should pass arguments to global parameters", () => {
      let text = "[[*this.contents(42) => x]][[x]][[fee]]";
      let context = {
        x: 11,
        fee: template("-[[x]]-")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("42-42-");
      })
    })

    it("should hide global parameters once they go out of scope", () => {
      let text = "[[+this.contents(18) => x]][[x]][[-this.contents]]*[[x]]";
      return render(text, { x: 32 }).then(result => {
        should(result).be.a.String().equal("18*32");
      })
    })

  })

  describe("promises", () => {

    it("should wait for expressions that result in promises", () => {
      let text = "abc [[fee]] xyz";
      let context = {
        fee: () => Promise.resolve("hello")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc hello xyz");
      })
    })

    it("should wait for promises in unary operators", () => {
      let text = "[[ -x]] [[!y]]";
      let context = {
        x: Promise.resolve(8),
        y: Promise.resolve(0)
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("-8 true");
      })
    })

    it("should wait for promises in binary operators", () => {
      let text = "[[x + y * z]]";
      let context = {
        x: 5,
        y: Promise.resolve(7),
        z: 10
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("75");
      })
    })

    it("should wait for promises in properties", () => {
      let text = "[[x.y]]";
      let context = { x: Promise.resolve({ y: "hello" }) };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("hello");
      })
    })

    it("should wait for promises in indexes", () => {
      let text = "[[x[1]]]";
      let context = { x: Promise.resolve(["a", "b", "c"]) };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("b");
      })
    })

    it("should wait for promises in function calls", () => {
      let text = "[[f(x, y, z)]]";
      let context = {
        f: Promise.resolve((n: number, m: number, o: number) => m + n + o),
        x: Promise.resolve(3),
        y: 4,
        z: Promise.resolve(5)
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("12");
      })
    })

    it("should wait for promises in pipes", () => {
      let text = "[[x | f]]";
      let context = {
        x: Promise.resolve(template("ding dong")),
        f: Promise.resolve((s: string) => s.toUpperCase())
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("DING DONG");
      })
    })

    it("should wait for promised templates", () => {
      let text = "abc [[fee]] xyz";
      let context = {
        fee: Promise.resolve(template("eee [[x]] fff")),
        x: "*"
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("abc eee * fff xyz");
      })
    })

    it("should render rejected promises", () => {
      let text = "[[fee]]";
      let context = {
        fee: Promise.reject("Whoops!")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Whoops!");
      })
    })

    it("should propagate promise failure", () => {
      let text = "[[3 + 7 * x == 10]]";
      let context = {
        x: Promise.reject("Yikes!")
      };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Yikes!")
      })
    })

  })

  describe("built-in locals", () => {

    it("should use let to create local variables", () => {
      let text = '[[*let(3, "a", true) -> x, y, z]][[x]]/[[y]]/[[z]]';
      return render(text).then(result => {
        should(result).be.a.String().equal("3/a/true");
      })
    })

    it("should use if for optional", () => {
      let text = "[[+if(x == 3)]]yay![[-if]][[+if(x == 4)]]boo![[-if]]";
      return render(text, { x: 3 }).then(result => {
        should(result).be.a.String().equal("yay!");
      })
    })

    it("should use else parameter for alternative", () => {
      let text = "[[+if(x == 3)]]boo![[*:else]]yay![[-if]]";
      return render(text, { x: 4 }).then(result => {
        should(result).be.a.String().equal("yay!")
      })
    })

    it("should use special syntax for else-if", () => {
      let tmpl = template(`[[+if (x == 3)]]abc
[[*:else if (x == 4)]]def
[[*:else if (x == 5)]]ghi
[[*:else]]jkl
[[-if]]`) as Helper;
      return Promise.all([
        render(tmpl, { x: 3 }).then(result => {
          should(result).be.a.String().equal("abc\n");
        }),
        render(tmpl, { x: 4 }).then(result => {
          should(result).be.a.String().equal("def\n");
        }),
        render(tmpl, { x: 5 }).then(result => {
          should(result).be.a.String().equal("ghi\n");
        }),
        render(tmpl, { x: 6 }).then(result => {
          should(result).be.a.String().equal("jkl\n");
        }),
      ]);
    })

    it("should use eachof to iterate over a list", () => {
      let text = "[[+eachof(xs) -> x]]([[x]])[[-eachof]]";
      return render(text, { xs: ["a", "b", "c"] }).then(result => {
        should(result).be.a.String().equal("(a)(b)(c)");
      })
    })

    it("should use require to read template files", () => {
      let text = '[[require("testrc/hello.blx")]]';
      let context = { name: "Suzy" };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Hello, Suzy!");
      })
    })

    it("should use require to read template files", () => {
      let text = '[[require("testrc/error.blx")]]';
      let context = { name: "Suzy" };
      return render(text, context).then(result => {
        should(result).be.a.String().equal("Unexpected character in bloc at testrc/error.blx:1:14");
      })
    })

  })

})