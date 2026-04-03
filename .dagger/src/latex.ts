/**
 * LaTeX helper functions for building LaTeX documents.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";
import { TEXLIVE_IMAGE } from "./constants";

/** Build a LaTeX resume (packages/resume) with xelatex. */
export function latexBuildHelper(pkgDir: Directory): Container {
  return dag
    .container()
    .from(TEXLIVE_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, {
      exclude: [".git"],
    })
    .withExec(["xelatex", "resume.tex"]);
}
