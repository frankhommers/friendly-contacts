/** Pure planning for moving contact notes to another folder. No Obsidian imports. */

export interface PlannedMove {
  from: string;
  to: string;
}

export interface SkippedMove {
  from: string;
  reason: string;
}

export interface MovePlan {
  moves: PlannedMove[];
  skipped: SkippedMove[];
}

/** No leading or trailing slashes; the vault root is the empty string. */
export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

function isInside(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(folder + "/");
}

function join(folder: string, relative: string): string {
  return folder === "" ? relative : `${folder}/${relative}`;
}

/**
 * Where each contact note goes when `fromFolder` becomes `toFolder`, keeping paths relative to the folder.
 * A target that exists, or a source outside `fromFolder`, is skipped with a reason.
 */
export function planMoves(
  paths: string[],
  fromFolder: string,
  toFolder: string,
  exists: (path: string) => boolean,
): MovePlan {
  const from = normalizeFolder(fromFolder);
  const to = normalizeFolder(toFolder);

  const targetInsideSource = isInside(to + "/", from);
  if (targetInsideSource && paths.some((path) => isInside(path, to))) {
    return {
      moves: [],
      skipped: paths.map((path) => ({ from: path, reason: "target is inside the contacts folder" })),
    };
  }

  const plan: MovePlan = { moves: [], skipped: [] };
  for (const path of paths) {
    if (from !== "" && !path.startsWith(from + "/")) {
      plan.skipped.push({ from: path, reason: `not inside ${from}` });
      continue;
    }
    const target = join(to, from === "" ? path : path.slice(from.length + 1));
    if (exists(target)) {
      plan.skipped.push({ from: path, reason: `target exists: ${target}` });
      continue;
    }
    plan.moves.push({ from: path, to: target });
  }
  return plan;
}

/** The Notice text after a move; when nothing moved the contacts folder setting is left alone. */
export function moveNotice(moved: number, skipped: number, toFolder: string): string {
  const target = toFolder === "" ? "the vault root" : toFolder;
  if (moved === 0) return `No contacts moved${skipped > 0 ? `, skipped ${skipped}, see console` : ""}`;
  return `Moved ${moved} contacts to ${target}${skipped > 0 ? `, skipped ${skipped}, see console` : ""}`;
}
