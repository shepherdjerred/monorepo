/**
 * LaTeX helper functions for building LaTeX documents.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

// renovate: datasource=docker depName=texlive/texlive
const TEXLIVE_IMAGE = "texlive/texlive:TL2024-historic";

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
