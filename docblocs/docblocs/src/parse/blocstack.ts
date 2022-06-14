import * as ast from "../ast";
import { ParseError } from "./error";

/**
 * Check whether the given opening expression can be closed by the
 * given closing expression.
 * @param open   The open expression
 * @param close  The closing expression
 * @returns      True if it can be closed, false if it cannot
 */
function canClose(open: ast.Expression, close: ast.Expression): boolean {
  return (
    ast.equals(open, close) ||
    open.type == "Application" && canClose(open.fn, close) ||
    open.type == "BinaryOperation" && open.op == "|" && canClose(open.left, close)
  );
}

/** A bloc that alsays has contents and may or may not have properties. */
export interface ContainerBloc {
  type: "RootBloc" | "Bloc" | "Definition";
  contents: ast.Template;
  properties?: ast.Definition[];
}

/**
 * Maintains a parallel stack of nodes and templates representing nested
 * blocks.  The node is the identifying node which will be used to close
 * the block.  The template is the contents of the block.
 */
export class BlocStack {

  /** Stack of blocks */
  blocs: (ContainerBloc)[] = [];

  /** Top of block stack */
  bloc: (ContainerBloc);

  /** Stack of identifiers. */
  ids: (ast.Expression|null)[] = [];

  /** Top of identifier stack. */
  id: ast.Expression;

  /**
   * Add new id/template pair to stack.
   * @param id        Identifying node for the block
   * @param template  Template for block contents
   */
  push(bloc: ContainerBloc, id: ast.Expression|null) {
    this.blocs.push(bloc);
    this.ids.push(id);
    this.bloc = bloc;
    if (id !== null) {
      this.id = id;
    }
  }

  /**
   * Removes top id/template pair, but only if id matches.
   * @param id  The node which must match the top id node
   * @returns   The template removed if id matches
   * @throws    ParseError if id does not match
   */
  pop(id: ast.Expression) {
    if (canClose(this.id, id)) {
      let i = this.ids.length - 1;
      while (this.ids[i] === null) {
        --i;
      }

      this.blocs.splice(i, this.blocs.length);
      this.ids.splice(i, this.ids.length);

      --i;
      this.bloc = this.blocs[i];
      while (this.ids[i] === null) {
        --i;
      }
      this.id = this.ids[i] as ast.Expression;
    }
    else if (this.ids.length == 1) {
      // The root bloc is implicit; shouldn't be explicitly closed
      throw new ParseError(`Unexpected closing tag: ${id}`, id);
    }
    else {
      throw new ParseError(`Expected [[-${ast.toString(this.id)}]]`, id);
    }
  }

}
