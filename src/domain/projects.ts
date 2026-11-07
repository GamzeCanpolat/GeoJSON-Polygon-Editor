import type { DatasetSummary } from './contracts';

/** HTTP DTOs match backend/app/schemas/projects.py; timestamps are ISO strings. */
export interface ProjectSummary {
  id: string;
  name: string;
  savedDatasetId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Project extends ProjectSummary {
  generationId: string;
  dataset: DatasetSummary;
}
export interface ProjectPage { items: ProjectSummary[]; total: number }
export interface ProjectWorkspace {
  id: string;
  projectId: string | null;
  activeDatasetId: string;
  generationId: string;
  dataset: DatasetSummary;
  createdAt: string;
  updatedAt: string;
}
export interface OpenedProject {
  workspace: ProjectWorkspace;
  /** Retained on the server, never implicitly saved/deleted by open(). */
  previousWorkspace: ProjectWorkspace | null;
}
export interface ProjectRepository {
  list(search?: string, offset?: number, limit?: number): Promise<ProjectPage>;
  get(id: string): Promise<Project>;
  create(name: string): Promise<Project>;
  save(id: string, expectedVersion: number): Promise<Project>;
  open(id: string, expectedProjectVersion: number): Promise<OpenedProject>;
  rename(id: string, name: string, expectedVersion: number): Promise<Project>;
  remove(id: string, expectedVersion: number): Promise<void>;
}
