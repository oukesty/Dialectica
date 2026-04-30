import { DeepPartial, createDeepPatch, createPatchBase, hasDeepConflict, mergeDeep } from "@/lib/deep-patch";
import { DiscussionProject } from "@/lib/types";

export type ProjectPatch = DeepPartial<DiscussionProject>;

export function createProjectPatch(current: DiscussionProject, next: DiscussionProject) {
  return createDeepPatch(current, next);
}

export function mergeProjectPatch(current: DiscussionProject, patch: ProjectPatch | undefined) {
  return mergeDeep(current, patch);
}

export function createProjectPatchBase(current: DiscussionProject, patch: ProjectPatch | undefined) {
  return createPatchBase(current, patch);
}

export function hasProjectConflict(current: DiscussionProject, patch: ProjectPatch | undefined, base: ProjectPatch | undefined) {
  return hasDeepConflict(current, patch, base);
}
