import { evaluate } from "./eval";
import { constructResult } from "./construct";
import { baseEnv } from "./env";
import { Identifier, Template, TemplateParamList } from "../ast";
import { parse } from "../parse";
import {
  curry,
  Maybe,
  Dictionary,
  Tree,
  flatten,
  Eventually,
  eventuallyCall,
  resolvePromises,
} from "../util";

export interface Helper {
  (context?: Dictionary<any>, bloc?: Dictionary<any>): Eventually<Tree<string>>;
}

export interface CurriedHelper {
  (...args: any[]): Helper;
}

export type BoundTemplate = Helper | CurriedHelper;

function renderTemplate(
  template: Template,
  locals: Dictionary<any>,
  context: Dictionary<any>,
  bloc: Dictionary<any>,
): Eventually<Tree<string>> {
  let results: Tree<string> = [];

  for (let child of template.children) {
    if (typeof child == "string") {
      results.push(child);
    } else {
      let newBloc: Dictionary<any> = {};

      let blocContext: Dictionary<any> = Object.create(context);

      let blocLocals: Dictionary<any> = Object.create(locals);
      blocLocals.this = newBloc;
      blocLocals.bloc = bloc;

      if (child.contents) {
        newBloc.contents = bindTemplate(child.contents, blocLocals);
      }

      if (child.properties) {
        for (let defn of child.properties) {
          if (defn.expression) {
            newBloc[defn.target.text] = evaluate(
              defn.expression,
              blocLocals,
              blocContext,
            );
          } else if (defn.contents) {
            newBloc[defn.target.text] = bindTemplate(defn.contents, blocLocals);
          }
        }
      }

      try {
        results.push(evaluate(child.expression, blocLocals, blocContext));
      } catch (err) {
        results.push(err.toString());
      }
    }
  }

  return resolvePromises(results, true);
}

export function bindTemplate(
  template: Template,
  locals: Dictionary<any>,
): BoundTemplate {
  if (template.params) {
    if (template.params.type == "local") {
      return (...args: any[]) => {
        let localArgs = Object.create(locals);
        if (template.params) {
          for (let i = 0, l = template.params.identifiers.length; i < l; ++i) {
            localArgs[template.params.identifiers[i].text] = args[i];
          }
        }
        return (context: Dictionary<any>, bloc: Dictionary<any>) =>
          renderTemplate(template, localArgs, context, bloc);
      };
    } else {
      return (...args: any[]) =>
        (context: Dictionary<any>, bloc: Dictionary<any>) => {
          let globalArgs = Object.create(context);
          if (template.params) {
            for (
              let i = 0, l = template.params.identifiers.length;
              i < l;
              ++i
            ) {
              globalArgs[template.params.identifiers[i].text] = args[i];
            }
          }
          return renderTemplate(template, locals, globalArgs, bloc);
        };
    }
  } else {
    return (context: Dictionary<any>, bloc: Dictionary<any>) =>
      renderTemplate(template, locals, context, bloc);
  }
}

export function template(templateText: string, source?: string): BoundTemplate {
  let template = parse(templateText, source);
  return bindTemplate(template, baseEnv);
}

export function render(
  template: string | Helper,
  context?: Dictionary<any>,
  bloc?: Dictionary<any>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      let helper: Helper;
      if (typeof template === "function") {
        helper = template;
      } else {
        helper = bindTemplate(parse(template), baseEnv) as Helper;
      }
      if (!context) {
        context = {};
      }
      if (!bloc) {
        bloc = {};
      }
      resolve(constructResult(helper(context, bloc)));
    } catch (error) {
      reject(error);
    }
  });
}
