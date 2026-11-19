import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  Folder,
  Hash,
  Search,
} from "lucide-react";
import { z } from "zod";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";
import { useShell } from "#client/shell/shell-context.ts";

const ProjectSortSchema = z.enum(["name-asc", "name-desc", "slug"]);
type ProjectSort = z.infer<typeof ProjectSortSchema>;

const projectSortOptions: (EnumOption & { value: ProjectSort })[] = [
  { value: "name-asc", label: "Name (A–Z)", icon: <ArrowDownAZ size={14} /> },
  { value: "name-desc", label: "Name (Z–A)", icon: <ArrowUpAZ size={14} /> },
  { value: "slug", label: "Slug", icon: <Hash size={14} /> },
];

export function Projects() {
  const { bootstrap } = useShell();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const parsedSort = ProjectSortSchema.safeParse(params.get("sort"));
  const sort: ProjectSort = parsedSort.success ? parsedSort.data : "name-asc";

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bootstrap.projects
      .filter(({ archivedAt }) => archivedAt === null)
      .filter(
        (project) =>
          needle === "" ||
          project.name.toLowerCase().includes(needle) ||
          project.slug.toLowerCase().includes(needle) ||
          project.description.toLowerCase().includes(needle),
      )
      .toSorted((a, b) => {
        switch (sort) {
          case "name-asc": {
            return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
          }
          case "name-desc": {
            return b.name.localeCompare(a.name) || a.slug.localeCompare(b.slug);
          }
          case "slug": {
            return a.slug.localeCompare(b.slug);
          }
        }
      });
  }, [bootstrap.projects, query, sort]);

  return (
    <div>
      <search
        className="collection-toolbar collection-toolbar-padded"
        aria-label="Filter and sort projects"
      >
        <div className="filter-search">
          <Search size={14} aria-hidden="true" />
          <input
            id="projects-search"
            type="search"
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              const value = event.target.value;
              if (value === "") {
                next.delete("q");
              } else {
                next.set("q", value);
              }
              setParams(next, { replace: true, preventScrollReset: true });
            }}
          />
        </div>
        <span className="spacer" />
        <EnumPicker
          id="projects-sort"
          label="Sort projects"
          value={sort}
          options={projectSortOptions}
          onChange={(value) => {
            const nextSort = ProjectSortSchema.parse(value);
            const next = new URLSearchParams(params);
            if (nextSort === "name-asc") {
              next.delete("sort");
            } else {
              next.set("sort", nextSort);
            }
            setParams(next, { preventScrollReset: true });
          }}
        />
      </search>
      <div className="project-grid">
        {projects.map((project) => (
          <Link
            className="project-card"
            key={project.id}
            to={`/projects/${project.slug}`}
          >
            <div>
              <span className="project-symbol" style={{ color: project.color }}>
                <Folder size={23} />
              </span>
              <ArrowUpRight size={16} />
            </div>
            <h2>{project.name}</h2>
            <p>
              {project.description || "Explore issues and move work forward."}
            </p>
            <span className="muted">{project.slug}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
