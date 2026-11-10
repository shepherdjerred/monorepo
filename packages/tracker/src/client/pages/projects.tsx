import { Link } from "react-router";
import { ArrowUpRight, Folder } from "lucide-react";
import { useShell } from "#client/shell/shell-context.ts";

export function Projects() {
  const { bootstrap } = useShell();
  return (
    <div className="project-grid">
      {bootstrap.projects
        .filter(({ archivedAt }) => archivedAt === null)
        .map((project) => (
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
  );
}
