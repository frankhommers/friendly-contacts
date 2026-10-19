/**
 * The licence notices of the npm packages bundled into main.js. Their licences (ISC, BSD-3-Clause, MIT) ask for the
 * copyright notice and licence text in every copy, so esbuild.config.mjs puts them at the top of main.js. The texts
 * are read from each package's LICENSE file at build time. THIRD_PARTY_NOTICES.md lists the same packages, and
 * tests/thirdPartyNotices.spec.ts fails when the bundle gains a package that is not listed here.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

/** Every package that ends up in main.js (directly or through another package). */
export const NOTICE_PACKAGES = [
	"d3-color",
	"d3-dispatch",
	"d3-drag",
	"d3-ease",
	"d3-force",
	"d3-interpolate",
	"d3-quadtree",
	"d3-selection",
	"d3-timer",
	"d3-transition",
	"d3-zoom",
	"react",
	"react-dom",
	"scheduler",
	"@preact/signals-core",
];

/** One comment with each licence text once, under the packages (name@version, licence) that share it. */
export function noticeBanner(root = process.cwd()) {
	const groups = new Map();
	for (const name of NOTICE_PACKAGES) {
		const dir = path.join(root, "node_modules", name);
		const { version, license } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
		const text = readFileSync(path.join(dir, "LICENSE"), "utf8").trim().replace(/\*\//g, "* /");
		const list = groups.get(text) ?? [];
		list.push(`${name}@${version} (${license})`);
		groups.set(text, list);
	}
	const sections = [...groups].map(([text, packages]) => `${packages.join(", ")}\n\n${text}`);
	return `/*\nThird-party software bundled in this file, with its licence notices:\n\n${sections.join("\n\n-----\n\n")}\n*/\n`;
}
