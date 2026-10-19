import { build } from 'esbuild';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

/** Bundled as the plugin bundles them: which inputs end up in the bundle, and what stays external. */
async function bundleOf(entry: string): Promise<{ inputs: string[]; external: string[] }> {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['obsidian'],
    metafile: true,
    logLevel: 'silent',
  });
  const output = Object.values(result.metafile.outputs)[0];
  return { inputs: Object.keys(result.metafile.inputs), external: output.imports.filter((i) => i.external).map((i) => i.path) };
}

describe('the sync core and the layout model load without Obsidian', () => {
  for (const entry of [
    'src/sync/syncFlow.ts',
    'src/sync/reviewExtras.ts',
    'src/sync/review.ts',
    'src/sync/reviewDisplay.ts',
    'src/sync/syncContact.ts',
    'src/contacts/layout.ts',
    'src/contacts/moveContacts.ts',
  ]) {
    it(`${entry} pulls in neither obsidian nor src/context`, async () => {
      const { inputs, external } = await bundleOf(entry);
      expect(external).not.toContain('obsidian');
      expect(inputs.filter((input) => input.includes('src/context/'))).toEqual([]);
    });
  }

  it('the check sees obsidian and src/context where they are used (src/sync/sync.ts)', async () => {
    const { inputs, external } = await bundleOf('src/sync/sync.ts');
    expect(external).toContain('obsidian');
    expect(inputs.filter((input) => input.includes('src/context/'))).not.toEqual([]);
  });
});
