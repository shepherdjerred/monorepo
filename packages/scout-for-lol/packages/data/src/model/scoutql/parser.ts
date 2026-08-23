import { CstParser, EOF } from "chevrotain";
import {
  All,
  And,
  As,
  Asc,
  At,
  Between,
  By,
  Cast,
  Comma,
  CurrentDate,
  CurrentTimestamp,
  Desc,
  Distinct,
  DoubleColon,
  Equals,
  False,
  Filter,
  From,
  Greater,
  GreaterEqual,
  Group,
  Having,
  HexColor,
  Identifier,
  Ilike,
  In,
  Interval,
  Is,
  LParen,
  Less,
  LessEqual,
  Like,
  Limit,
  LtGt,
  Minus,
  Not,
  NotEquals,
  Null,
  NumberLiteral,
  Or,
  Order,
  Percent,
  Plus,
  RParen,
  Render,
  Select,
  Slash,
  Star,
  StringLiteral,
  Time,
  True,
  Where,
  With,
  Zone,
  scoutQlTokenTypes,
} from "#src/model/scoutql/tokens.ts";

// ── ScoutQL v2 grammar ───────────────────────────────────────────────────────
// One fault-tolerant Chevrotain CstParser is the single grammar artifact.
// Clauses are OPTION-guarded so a missing or malformed clause re-syncs at the
// next clause keyword instead of aborting the parse; parse.ts reports absent
// required clauses (SELECT, FROM) as diagnostics. The expression ladder mirrors
// SQL precedence: OR → AND → NOT → comparison/IN/BETWEEN/LIKE/IS NULL →
// additive → multiplicative → postfix (::cast, AT TIME ZONE) → unary → primary.

export class ScoutQlCstParser extends CstParser {
  constructor() {
    super(scoutQlTokenTypes, {
      recoveryEnabled: true,
      nodeLocationTracking: "full",
    });
    this.performSelfAnalysis();
  }

  readonly query = this.RULE("query", () => {
    this.OPTION(() => this.SUBRULE(this.selectClause));
    this.OPTION1(() => this.SUBRULE(this.fromClause));
    this.OPTION2(() => this.SUBRULE(this.whereClause));
    this.OPTION3(() => this.SUBRULE(this.groupByClause));
    this.OPTION4(() => this.SUBRULE(this.havingClause));
    this.OPTION5(() => this.SUBRULE(this.orderByClause));
    this.OPTION6(() => this.SUBRULE(this.limitClause));
    this.OPTION7(() => this.SUBRULE(this.renderClause));
    this.CONSUME(EOF);
  });

  readonly selectClause = this.RULE("selectClause", () => {
    this.CONSUME(Select);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => this.SUBRULE(this.selectItem),
    });
  });

  readonly selectItem = this.RULE("selectItem", () => {
    this.SUBRULE(this.expr);
    this.OPTION(() => {
      this.CONSUME(As);
      this.CONSUME(Identifier);
    });
  });

  readonly fromClause = this.RULE("fromClause", () => {
    this.CONSUME(From);
    this.CONSUME(Identifier);
  });

  readonly whereClause = this.RULE("whereClause", () => {
    this.CONSUME(Where);
    this.SUBRULE(this.expr);
  });

  readonly groupByClause = this.RULE("groupByClause", () => {
    this.CONSUME(Group);
    this.CONSUME(By);
    this.OR([
      { ALT: () => this.CONSUME(All) },
      {
        ALT: () => {
          this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.groupingItem),
          });
        },
      },
    ]);
  });

  readonly groupingItem = this.RULE("groupingItem", () => {
    this.SUBRULE(this.expr);
  });

  readonly havingClause = this.RULE("havingClause", () => {
    this.CONSUME(Having);
    this.SUBRULE(this.expr);
  });

  readonly orderByClause = this.RULE("orderByClause", () => {
    this.CONSUME(Order);
    this.CONSUME(By);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => this.SUBRULE(this.orderKey),
    });
  });

  readonly orderKey = this.RULE("orderKey", () => {
    this.SUBRULE(this.expr);
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.CONSUME(Asc) },
        { ALT: () => this.CONSUME(Desc) },
      ]);
    });
  });

  readonly limitClause = this.RULE("limitClause", () => {
    this.CONSUME(Limit);
    this.CONSUME(NumberLiteral);
  });

  readonly renderClause = this.RULE("renderClause", () => {
    this.CONSUME(Render);
    this.CONSUME(Identifier);
    this.OPTION(() => {
      this.CONSUME(With);
      this.CONSUME(LParen);
      this.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => this.SUBRULE(this.renderOption),
      });
      this.CONSUME(RParen);
    });
  });

  readonly renderOption = this.RULE("renderOption", () => {
    this.CONSUME(Identifier);
    this.CONSUME(Equals);
    this.SUBRULE(this.renderValue);
  });

  readonly renderValue = this.RULE("renderValue", () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(HexColor) },
      { ALT: () => this.CONSUME(True) },
      { ALT: () => this.CONSUME(False) },
      // `mentions = all` — ALL is a keyword, so it needs its own alternative.
      { ALT: () => this.CONSUME(All) },
      { ALT: () => this.CONSUME(Identifier) },
      {
        ALT: () => {
          this.CONSUME(LParen);
          this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => this.SUBRULE(this.renderListItem),
          });
          this.CONSUME(RParen);
        },
      },
    ]);
  });

  readonly renderListItem = this.RULE("renderListItem", () => {
    this.OR([
      { ALT: () => this.CONSUME(HexColor) },
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(NumberLiteral) },
      // renderPair (identifier "=" …) before the bare identifier: both start
      // with Identifier, so the longer path must have priority.
      { ALT: () => this.SUBRULE(this.renderPair) },
      { ALT: () => this.CONSUME(Identifier) },
    ]);
  });

  readonly renderPair = this.RULE("renderPair", () => {
    this.CONSUME(Identifier);
    this.CONSUME(Equals);
    this.OR([
      { ALT: () => this.CONSUME1(Identifier) },
      { ALT: () => this.CONSUME(StringLiteral) },
    ]);
  });

  // ── Expression precedence ladder (lowest → highest) ────────────────────────

  readonly expr = this.RULE("expr", () => {
    this.SUBRULE(this.orExpr);
  });

  readonly orExpr = this.RULE("orExpr", () => {
    this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(Or);
      this.SUBRULE1(this.andExpr);
    });
  });

  readonly andExpr = this.RULE("andExpr", () => {
    this.SUBRULE(this.notExpr);
    this.MANY(() => {
      this.CONSUME(And);
      this.SUBRULE1(this.notExpr);
    });
  });

  readonly notExpr = this.RULE("notExpr", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Not);
          this.SUBRULE(this.notExpr);
        },
      },
      { ALT: () => this.SUBRULE(this.comparison) },
    ]);
  });

  readonly comparison = this.RULE("comparison", () => {
    this.SUBRULE(this.additive);
    this.OPTION(() => {
      this.OR([
        {
          ALT: () => {
            this.SUBRULE(this.compOp);
            this.SUBRULE1(this.additive);
          },
        },
        {
          ALT: () => {
            this.OPTION1(() => this.CONSUME(Not));
            this.OR1([
              {
                ALT: () => {
                  this.CONSUME(In);
                  this.CONSUME(LParen);
                  this.AT_LEAST_ONE_SEP({
                    SEP: Comma,
                    DEF: () => this.SUBRULE(this.expr),
                  });
                  this.CONSUME(RParen);
                },
              },
              {
                ALT: () => {
                  this.CONSUME(Between);
                  this.SUBRULE2(this.additive);
                  this.CONSUME(And);
                  this.SUBRULE3(this.additive);
                },
              },
              {
                ALT: () => {
                  this.CONSUME(Like);
                  this.SUBRULE4(this.additive);
                },
              },
              {
                ALT: () => {
                  this.CONSUME(Ilike);
                  this.SUBRULE5(this.additive);
                },
              },
            ]);
          },
        },
        {
          ALT: () => {
            this.CONSUME(Is);
            this.OPTION2(() => this.CONSUME1(Not));
            this.CONSUME(Null);
          },
        },
      ]);
    });
  });

  readonly compOp = this.RULE("compOp", () => {
    this.OR([
      { ALT: () => this.CONSUME(Equals) },
      { ALT: () => this.CONSUME(NotEquals) },
      { ALT: () => this.CONSUME(LtGt) },
      { ALT: () => this.CONSUME(LessEqual) },
      { ALT: () => this.CONSUME(GreaterEqual) },
      { ALT: () => this.CONSUME(Less) },
      { ALT: () => this.CONSUME(Greater) },
    ]);
  });

  readonly additive = this.RULE("additive", () => {
    this.SUBRULE(this.multiplicative);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Plus) },
        { ALT: () => this.CONSUME(Minus) },
      ]);
      this.SUBRULE1(this.multiplicative);
    });
  });

  readonly multiplicative = this.RULE("multiplicative", () => {
    this.SUBRULE(this.postfix);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Star) },
        { ALT: () => this.CONSUME(Slash) },
        { ALT: () => this.CONSUME(Percent) },
      ]);
      this.SUBRULE1(this.postfix);
    });
  });

  readonly postfix = this.RULE("postfix", () => {
    this.SUBRULE(this.unary);
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(DoubleColon);
            this.SUBRULE(this.typeName);
          },
        },
        {
          ALT: () => {
            this.CONSUME(At);
            this.CONSUME(Time);
            this.CONSUME(Zone);
            this.CONSUME(StringLiteral);
          },
        },
      ]);
    });
  });

  readonly unary = this.RULE("unary", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Minus);
          this.SUBRULE(this.unary);
        },
      },
      { ALT: () => this.SUBRULE(this.primary) },
    ]);
  });

  readonly primary = this.RULE("primary", () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(True) },
      { ALT: () => this.CONSUME(False) },
      { ALT: () => this.CONSUME(Null) },
      { ALT: () => this.CONSUME(CurrentTimestamp) },
      { ALT: () => this.CONSUME(CurrentDate) },
      {
        ALT: () => {
          this.CONSUME(Interval);
          this.OR1([
            {
              ALT: () => {
                this.CONSUME1(NumberLiteral);
                this.OPTION(() => this.CONSUME(Identifier));
              },
            },
            // INTERVAL '30 days'
            { ALT: () => this.CONSUME1(StringLiteral) },
          ]);
        },
      },
      {
        ALT: () => {
          this.CONSUME(Cast);
          this.CONSUME(LParen);
          this.SUBRULE(this.expr);
          this.CONSUME(As);
          this.SUBRULE(this.typeName);
          this.CONSUME(RParen);
        },
      },
      { ALT: () => this.SUBRULE(this.callOrColumn) },
      {
        ALT: () => {
          this.CONSUME1(LParen);
          this.SUBRULE1(this.expr);
          this.CONSUME1(RParen);
        },
      },
    ]);
  });

  readonly callOrColumn = this.RULE("callOrColumn", () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      // `group(2)` / `group(all)`: GROUP is a clause keyword, but it is also
      // the player_groups grouping function's name.
      { ALT: () => this.CONSUME(Group) },
    ]);
    this.OPTION(() => {
      this.CONSUME(LParen);
      this.SUBRULE(this.callArgs);
      this.CONSUME(RParen);
      this.OPTION1(() => this.SUBRULE(this.filterSuffix));
    });
  });

  // "*" only COUNT; ALL only group() — enforced by analysis, parsed permissively.
  readonly callArgs = this.RULE("callArgs", () => {
    this.OPTION(() => this.CONSUME(Distinct));
    this.OPTION1(() => {
      this.OR([
        { ALT: () => this.CONSUME(Star) },
        { ALT: () => this.CONSUME(All) },
        {
          ALT: () => {
            this.AT_LEAST_ONE_SEP({
              SEP: Comma,
              DEF: () => this.SUBRULE(this.expr),
            });
          },
        },
      ]);
    });
  });

  readonly filterSuffix = this.RULE("filterSuffix", () => {
    this.CONSUME(Filter);
    this.CONSUME(LParen);
    this.CONSUME(Where);
    this.SUBRULE(this.expr);
    this.CONSUME(RParen);
  });

  readonly typeName = this.RULE("typeName", () => {
    this.CONSUME(Identifier);
  });
}
