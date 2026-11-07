import type { OpenedProject, Project, ProjectPage, ProjectRepository, ProjectWorkspace } from '../../domain/projects';

/** Internal capability supplied by the owning API adapter, not a second session. */
export interface ProjectSessionAccess {
  current(): ProjectWorkspace | null;
  ready(): Promise<ProjectWorkspace>;
  json<T>(path: string, method?: string, body?: unknown): Promise<T>;
  remove(path: string): Promise<void>;
  switchWorkspace(workspace: ProjectWorkspace): void;
  linkProject(id: string | null): void;
}
export type ProjectSessionRunner = <T>(task: (session: ProjectSessionAccess) => Promise<T>) => Promise<T>;

function expected(workspace: ProjectWorkspace) {
  return {
    workspaceId: workspace.id,
    expectedDatasetId: workspace.activeDatasetId,
    expectedGenerationId: workspace.generationId,
    expectedRevision: workspace.dataset.revision,
  };
}
const path = (id: string) => {
  if (!id.trim()) throw new Error('Geçerli bir proje kimliği gerekli.');
  return '/projects/' + encodeURIComponent(id);
};

/** Obtain via ApiGeoJsonRepository.projects so FIFO/state/transport are shared. */
export class ApiProjectRepository implements ProjectRepository {
  constructor(private readonly run: ProjectSessionRunner) {}

  list(search = '', offset = 0, limit = 50): Promise<ProjectPage> {
    return this.run(session => session.json('/projects?' + new URLSearchParams({ search, offset: String(offset), limit: String(limit) })));
  }
  get(id: string): Promise<Project> { return this.run(session => session.json(path(id))); }

  create(name: string): Promise<Project> {
    return this.run(async session => {
      const workspace = await session.ready();
      const project = await session.json<Project>('/projects', 'POST', { name, ...expected(workspace) });
      session.linkProject(project.id);
      return project;
    });
  }
  save(id: string, expectedVersion: number): Promise<Project> {
    return this.run(async session => {
      const workspace = await session.ready();
      return session.json(path(id) + '/content', 'PUT', { expectedVersion, ...expected(workspace) });
    });
  }
  open(id: string, expectedProjectVersion: number): Promise<OpenedProject> {
    return this.run(async session => {
      const previousWorkspace = session.current();
      // Existing POST /workspaces clones the saved snapshot. Unlike replacing
      // content in-place this keeps unsaved previous workspace data reachable.
      const workspace = await session.json<ProjectWorkspace>('/workspaces', 'POST', { projectId: id, expectedProjectVersion });
      session.switchWorkspace(workspace);
      return { workspace: structuredClone(workspace), previousWorkspace };
    });
  }
  rename(id: string, name: string, expectedVersion: number): Promise<Project> {
    return this.run(session => session.json(path(id), 'PATCH', { name, expectedVersion }));
  }
  remove(id: string, expectedVersion: number): Promise<void> {
    return this.run(async session => {
      await session.remove(path(id) + '?' + new URLSearchParams({ expectedVersion: String(expectedVersion) }));
      if (session.current()?.projectId === id) session.linkProject(null);
    });
  }
}
