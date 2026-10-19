import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_PACKAGES, noticeBanner } from '../third-party-notices.mjs';

const root = path.resolve(__dirname, '..');

/** The npm packages that end up in main.js, as the plugin bundles it. */
async function bundledPackages(): Promise<string[]> {
  const result = await build({
    entryPoints: [path.join(root, 'src/main.ts')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
    treeShaking: true,
    minify: true,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.values(result.metafile.outputs)[0].inputs;
  const packages = new Set<string>();
  for (const [file, { bytesInOutput }] of Object.entries(inputs)) {
    const name = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file)?.[1];
    if (name && bytesInOutput > 0) packages.add(name);
  }
  return [...packages].sort();
}

describe('third-party notices', () => {
  it('cover every package bundled into main.js, in the banner and in THIRD_PARTY_NOTICES.md', async () => {
    const bundled = await bundledPackages();
    expect(bundled).toContain('d3-force');
    expect(bundled.filter((p) => !(NOTICE_PACKAGES as string[]).includes(p))).toEqual([]);
    const file = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(bundled.filter((p) => !file.includes(`\`${p}\``))).toEqual([]);
  }, 30000);

  it('the banner carries the licence texts (ISC, BSD-3-Clause, MIT) as a single comment', () => {
    const banner: string = noticeBanner(root);
    expect(banner.startsWith('/*')).toBe(true);
    expect(banner.trimEnd().endsWith('*/')).toBe(true);
    expect(banner.slice(2, -3)).not.toContain('*/');
    expect(banner).toContain('Copyright 2010-2021 Mike Bostock');
    expect(banner).toContain('Copyright 2001 Robert Penner');
    expect(banner).toContain('Redistributions in binary form must reproduce the above copyright notice');
    expect(banner).toContain('Permission to use, copy, modify, and/or distribute this software');
    expect(banner).toContain('Copyright (c) Facebook, Inc. and its affiliates.');
    expect(banner).toContain('Copyright (c) 2022-present Preact Team');
    for (const pkg of NOTICE_PACKAGES as string[]) expect(banner).toContain(pkg);
  });
});
