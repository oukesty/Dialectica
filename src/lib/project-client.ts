import { createProjectPatch, createProjectPatchBase, ProjectPatch } from "@/lib/project-update";
import { DiscussionProject } from "@/lib/types";

type ProjectResponse = {
  code?: string;
  error?: string;
  project?: DiscussionProject;
  currentProject?: DiscussionProject;
};

export class ProjectConflictError extends Error {
  currentProject?: DiscussionProject;

  constructor(message: string, currentProject?: DiscussionProject) {
    super(message);
    this.name = "ProjectConflictError";
    this.currentProject = currentProject;
  }
}

async function readProjectResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as ProjectResponse | null;
  if (response.status === 409 && payload?.code === "conflict") {
    throw new ProjectConflictError(payload.error ?? "Project changed in another tab.", payload.currentProject);
  }
  if (!response.ok || !payload?.project) {
    throw new Error(payload?.error ?? "Failed to update project.");
  }
  return payload.project;
}

export async function patchProjectState(
  projectId: string,
  patch: ProjectPatch,
  options: { baseProject?: DiscussionProject; locale?: string } = {},
) {
  const endpoint = options.locale
    ? `/api/projects/${projectId}?locale=${encodeURIComponent(options.locale)}`
    : `/api/projects/${projectId}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patch,
      base: options.baseProject ? createProjectPatchBase(options.baseProject, patch) : undefined,
    }),
  });
  return readProjectResponse(response);
}

export async function saveProjectChanges(previous: DiscussionProject, next: DiscussionProject, options: { locale?: string } = {}) {
  const patch = createProjectPatch(previous, next);
  if (!patch) {
    return previous;
  }
  return patchProjectState(next.id, patch, { baseProject: previous, locale: options.locale ?? next.language });
}
