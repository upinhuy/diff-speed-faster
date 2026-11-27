// A faster drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// Same answer, less CPU. The rule it reproduces, in its own words: a text is
// cut after every "\n" (the only separator; a "\r" is part of its line) and a
// last line with no "\n" is a line too; two lines are equal only when they are
// the same code units, newline or its absence included. The edit script keeps
// the common prefix of lines, then the common suffix of what is left, and
// between them runs Myers's greedy search from the first lines: for d edits
// and each diagonal k = x - y, the furthest point a path of d edits reaches on
// k is one old line past the furthest (d-1)-point on k - 1 (a deletion) or one
// new line past the furthest (d-1)-point on k + 1 (an insertion), whichever
// lies further into the old text, the deletion when both reach the same point;
// a move past the end of either text is no candidate, no edge diagonal is
// pruned, and every run of lines equal in both is followed as far as it goes.
// The first path to reach both ends is the script. The patch is a first line
// "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I", then each hunk:
// "@ os ol ns nl" and one line per line it covers, "=" kept, "-" deleted,
// "+" inserted; each run of changes lists its deletions before its insertions
// and shows up to 3 kept lines before and after it, and two runs at most 6
// kept lines apart share a hunk. A line that ends its text with no newline is
// written with one and followed by a line "%". Identical texts are the first
// line alone.
//
// Speed comes from three changes over the reference shape, none of which
// changes an answer: lines are interned to small integers once (so every
// comparison inside the search is one integer compare), the search keeps its
// furthest-x table in typed arrays with one snapshot per depth (so the exact
// path the greedy search took can be walked back without rebuilding it), and
// the patch is built from those integer runs instead of linked path objects.

/** The op of a kept, a deleted and an inserted line, as runs record them. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** How many kept lines surround each change run inside a hunk. */
const CONTEXT = 3;

/**
 * A text's lines as integer ids. Lines are interned through one map shared
 * by both texts, so two lines share an id exactly when they are the same code
 * units, and byId[id] keeps the line's text for the patch.
 */
function tokenize(text, intern, byId) {
  const ids = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      if (start < text.length) pushLine(text.slice(start));
      break;
    }
    pushLine(text.slice(start, nl + 1));
    start = nl + 1;
  }
  return Int32Array.from(ids);

  function pushLine(line) {
    let id = intern.get(line);
    if (id === undefined) {
      id = byId.length;
      intern.set(line, id);
      byId.push(line);
    }
    ids.push(id);
  }
}

/**
 * The runs of the edit script of a into b: [kind, count] pairs in order.
 * The forward search below is Myers's greedy search with make.fun's
 * tie-break (the deletion when a deletion and an insertion reach the same
 * point into the old text). V[d][k] is the furthest old-line count reached on
 * diagonal k after d edits and the snake that follows them, or -1 when no
 * path of d edits reaches k at all; the trace keeps one snapshot per depth so
 * the path the search took can be walked back exactly.
 */
function myersRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];

  const maxD = n + m;
  // V tables are indexed by k + off; a snapshot per depth is kept in trace.
  const off = maxD + 1;
  let prev = new Int32Array(2 * maxD + 3).fill(-1);
  let cur = new Int32Array(2 * maxD + 3).fill(-1);
  const trace = [];

  // Depth 0: the snake from the first lines on diagonal 0.
  let x = 0;
  while (x < n && x < m && a[x] === b[x]) x++;
  prev[off] = x;
  trace.push(new Int32Array([x]));
  if (x === n && x === m) return [[KEEP, x]];

  let depth = -1;
  search: for (let d = 1; d <= maxD; d++) {
    // The two edge diagonals have one candidate each; the inner diagonals
    // have both, and the range checks fall away because k - 1 and k + 1 are
    // always inside the previous depth's diagonals there. j walks the
    // tables beside k, and mk walks m + k beside it.
    let j = off - d;
    {
      // k = -d: the insertion only, from the (d-1)-path on -(d-1).
      const fromIns = prev[j + 1];
      let xx = -1;
      if (fromIns >= 0 && fromIns <= m - d) xx = fromIns;
      if (xx >= 0) {
        let yy = xx + d;
        while (xx < n && yy < m && a[xx] === b[yy]) {
          xx++;
          yy++;
        }
        cur[j] = xx;
        if (xx === n && yy === m) {
          depth = d;
          break search;
        }
      } else cur[j] = -1;
    }
    j += 2;
    let mk = m - d + 2;
    for (let k = -d + 2; k <= d - 2; k += 2, j += 2, mk += 2) {
      const fromDel = prev[j - 1];
      const fromIns = prev[j + 1];
      let xx;
      if (fromDel >= 0 && fromDel < n) {
        const delX = fromDel + 1;
        xx = fromIns >= 0 && fromIns <= mk && fromIns > delX ? fromIns : delX;
      } else if (fromIns >= 0 && fromIns <= mk) xx = fromIns;
      else {
        cur[j] = -1;
        continue;
      }
      // Follow every run of lines equal in both as far as it goes.
      let yy = xx - k;
      while (xx < n && yy < m && a[xx] === b[yy]) {
        xx++;
        yy++;
      }
      cur[j] = xx;
      if (xx === n && yy === m) {
        depth = d;
        break search;
      }
    }
    {
      // k = d: the deletion only, from the (d-1)-path on d - 1.
      const fromDel = prev[j - 1];
      let xx = -1;
      if (fromDel >= 0 && fromDel < n) xx = fromDel + 1;
      if (xx >= 0) {
        let yy = xx - d;
        while (xx < n && yy < m && a[xx] === b[yy]) {
          xx++;
          yy++;
        }
        cur[j] = xx;
        if (xx === n && yy === m) {
          depth = d;
          break search;
        }
      } else cur[j] = -1;
    }
    trace.push(cur.slice(off - d, off + d + 1));
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  if (depth < 0) throw new Error('diff: the search ended without reaching both ends');

  // Walk the path back from both ends at depth `depth`, peeling one edit
  // and the snake that followed it at a time. The predecessor of the point
  // at (depth, k) is decided from the (depth - 1) snapshot by the same rule
  // the forward search used, so the walk retraces the search's own path.
  const reversed = [];
  let px = n;
  let py = m;
  for (let d = depth; d >= 1; d--) {
    const k = px - py;
    const snap = trace[d - 1];
    const base = d - 1;
    let delPrev = -1;
    let insPrev = -1;
    if (k - 1 >= -base && k - 1 <= base) {
      const v = snap[k - 1 + base];
      if (v >= 0 && v < n) delPrev = v;
    }
    if (k + 1 >= -base && k + 1 <= base) {
      const v = snap[k + 1 + base];
      if (v >= 0 && v <= m + k) insPrev = v;
    }
    let isDel;
    if (delPrev >= 0 && (insPrev < 0 || delPrev + 1 >= insPrev)) isDel = true;
    else if (insPrev >= 0) isDel = false;
    else throw new Error('diff: the walk back found no predecessor');
    if (isDel) {
      const ox = delPrev;
      const oy = ox - (k - 1);
      const keep = px - (ox + 1);
      if (keep > 0) reversed.push([KEEP, keep]);
      reversed.push([DELETE, 1]);
      px = ox;
      py = oy;
    } else {
      const ox = insPrev;
      const oy = ox - (k + 1);
      const keep = px - ox;
      if (keep > 0) reversed.push([KEEP, keep]);
      reversed.push([INSERT, 1]);
      px = ox;
      py = oy;
    }
  }
  // Depth 0: the opening snake from the first lines to (px, py).
  if (px > 0) reversed.push([KEEP, px]);
  reversed.reverse();
  const runs = [];
  for (const [kind, count] of reversed) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** One patch line: the op, the line itself, and a "%" line after it when the line had no newline of its own. */
function emitLine(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/**
 * make.fun's own patch of the two texts, from their interned lines and the
 * edit script's runs: the first line with the counts, then each hunk with up
 * to 3 kept lines before and after every change run, runs at most 6 kept
 * lines apart sharing a hunk.
 */
function patch(a, b, n, m, runs, byId) {
  // Group the script's edits into change blocks: a block is the deletions
  // and insertions between two kept stretches, and it remembers where it
  // sits in each text.
  const blocks = [];
  let oldLine = 0;
  let newLine = 0;
  let deleted = 0;
  let inserted = 0;
  for (const [kind, count] of runs) {
    if (kind === KEEP) {
      oldLine += count;
      newLine += count;
      continue;
    }
    const prev = blocks[blocks.length - 1];
    const adjacent =
      prev !== undefined && oldLine === prev.old + prev.del && newLine === prev.new + prev.ins;
    const block = adjacent
      ? prev
      : { old: oldLine, new: newLine, del: 0, ins: 0 };
    if (!adjacent) blocks.push(block);
    if (kind === DELETE) {
      block.del += count;
      oldLine += count;
      deleted += count;
    } else {
      block.ins += count;
      newLine += count;
      inserted += count;
    }
  }

  // Gather blocks into hunks: a hunk takes every block whose kept gap to
  // the block before it is at most twice the context.
  const hunks = [];
  for (const block of blocks) {
    const hunk = hunks[hunks.length - 1];
    const lastBlock = hunk !== undefined ? hunk[hunk.length - 1] : undefined;
    const gap = lastBlock === undefined ? Infinity : block.old - (lastBlock.old + lastBlock.del);
    if (lastBlock !== undefined && gap <= 2 * CONTEXT) hunk.push(block);
    else hunks.push([block]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const hunk of hunks) {
    const head = hunk[0];
    const tail = hunk[hunk.length - 1];
    // How many kept lines the hunk shows ahead of its first block (never
    // more than the context, and never before the text starts), and behind
    // its last block (never more than the context, and never past the end).
    const lead = Math.min(CONTEXT, head.old);
    const trail = Math.min(CONTEXT, n - (tail.old + tail.del));
    const oldFrom = head.old - lead;
    const oldTo = tail.old + tail.del + trail;
    const newFrom = head.new - lead;
    const newTo = tail.new + tail.ins + trail;
    out.push(`@ ${oldFrom + 1} ${oldTo - oldFrom} ${newFrom + 1} ${newTo - newFrom}\n`);
    let at = oldFrom;
    for (const block of hunk) {
      for (; at < block.old; at++) out.push(emitLine('=', byId[a[at]]));
      for (let i = 0; i < block.del; i++) out.push(emitLine('-', byId[a[block.old + i]]));
      for (let i = 0; i < block.ins; i++) out.push(emitLine('+', byId[b[block.new + i]]));
      at = block.old + block.del;
    }
    for (; at < oldTo; at++) out.push(emitLine('=', byId[a[at]]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input, computed faster. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const intern = new Map();
  const byId = [];
  const a = tokenize(input.old, intern, byId);
  const b = tokenize(input.new, intern, byId);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  runs.push(...myersRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push([KEEP, suffix]);
  return patch(a, b, n, m, runs, byId);
}
