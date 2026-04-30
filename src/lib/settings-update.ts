import { createDeepPatch, createPatchBase, DeepPartial, hasDeepConflict, mergeDeep } from "@/lib/deep-patch";
import { AppSettings } from "@/lib/types";

export type SettingsPatch = DeepPartial<AppSettings>;
export { createDeepPatch, mergeDeep };

export function createSettingsPatchBase(current: AppSettings, patch: SettingsPatch | undefined) {
  return createPatchBase(current, patch);
}

export function hasSettingsConflict(current: AppSettings, patch: SettingsPatch | undefined, base: SettingsPatch | undefined) {
  return hasDeepConflict(current, patch, base);
}
