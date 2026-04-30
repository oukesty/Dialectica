import { readdir } from 'node:fs/promises';
import path from 'node:path';

const dataRoot = path.join(process.cwd(), 'data');
const projectsRoot = path.join(dataRoot, 'projects');
const collaborationRoot = path.join(dataRoot, 'collaboration');
const uploadsRoot = path.join(dataRoot, 'uploads');
const knowledgeRoot = path.join(dataRoot, 'knowledge');

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

async function listNames(root, options = {}) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => options.kind === 'dir' ? entry.isDirectory() : options.kind === 'file' ? entry.isFile() : true)
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

const projectIds = new Set((await listNames(projectsRoot, { kind: 'file' }))
  .filter((name) => name.endsWith('.json'))
  .map((name) => stripExt(name)));

const collaborationOrphans = (await listNames(collaborationRoot, { kind: 'file' }))
  .filter((name) => name.endsWith('.json'))
  .filter((name) => !projectIds.has(stripExt(name)));

const uploadOrphans = (await listNames(uploadsRoot, { kind: 'dir' }))
  .filter((name) => !projectIds.has(name));

const knowledgeOrphans = (await listNames(knowledgeRoot, { kind: 'file' }))
  .filter((name) => /^project_[^.]+\.[^.]+\.json$/.test(name))
  .filter((name) => !projectIds.has(name.replace(/\.[^.]+\.json$/, '')));

console.log(JSON.stringify({
  projectCount: projectIds.size,
  collaborationOrphans,
  uploadOrphans,
  knowledgeOrphans,
}, null, 2));
