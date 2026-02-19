const MAX_LINE_LENGTH = 500;
const TAB_WIDTH = 4;
const COMMENT_PREFIXES = ['#', '//', '--'];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

interface LineRecord {
  number: number;
  raw: string;
  display: string;
  indent: number;
}

interface IndentationArgs {
  anchorLine?: number;
  maxLevels: number;
  includeSiblings: boolean;
  includeHeader: boolean;
  maxLines?: number;
}

const DEFAULT_INDENTATION: IndentationArgs = {
  maxLevels: 0,
  includeSiblings: false,
  includeHeader: true,
};

function isBlank(record: LineRecord): boolean {
  return record.raw.trimStart().length === 0;
}

function isComment(record: LineRecord): boolean {
  const trimmed = record.raw.trim();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function formatLine(raw: string): string {
  if (raw.length > MAX_LINE_LENGTH) {
    // Truncate at char boundary (JS strings are UTF-16, so just slice)
    return raw.slice(0, MAX_LINE_LENGTH);
  }
  return raw;
}

function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent += 1;
    else if (ch === '\t') indent += TAB_WIDTH;
    else break;
  }
  return indent;
}

function computeEffectiveIndents(records: LineRecord[]): number[] {
  const effective: number[] = [];
  let previousIndent = 0;
  for (const record of records) {
    if (isBlank(record)) {
      effective.push(previousIndent);
    } else {
      previousIndent = record.indent;
      effective.push(previousIndent);
    }
  }
  return effective;
}

function trimEmptyLines(out: LineRecord[]): LineRecord[] {
  let start = 0;
  while (start < out.length && out[start].raw.trim().length === 0) start++;
  let end = out.length - 1;
  while (end >= start && out[end].raw.trim().length === 0) end--;
  return out.slice(start, end + 1);
}

function collectFileLines(content: string): LineRecord[] {
  const rawLines = content.split('\n');
  // Remove trailing empty line from final newline
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  return rawLines.map((raw, i) => {
    // Strip \r for CRLF
    const cleaned = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    return {
      number: i + 1,
      raw: cleaned,
      display: formatLine(cleaned),
      indent: measureIndent(cleaned),
    };
  });
}

// --- Slice mode ---

function readSlice(content: string, offset: number, limit: number): string[] {
  const lines = content.split('\n');
  // Remove trailing empty line from final newline
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const totalLines = lines.length;
  if (offset > totalLines) {
    throw new Error('offset exceeds file length');
  }

  const collected: string[] = [];
  for (let i = offset - 1; i < totalLines && collected.length < limit; i++) {
    let raw = lines[i];
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    const formatted = formatLine(raw);
    collected.push(`L${i + 1}: ${formatted}`);
  }
  return collected;
}

// --- Indentation mode ---

function readBlock(
  content: string,
  offset: number,
  limit: number,
  options: IndentationArgs,
): string[] {
  const anchorLine = options.anchorLine ?? offset;
  if (anchorLine === 0) throw new Error('anchorLine must be a 1-indexed line number');

  const guardLimit = options.maxLines ?? limit;
  if (guardLimit === 0) throw new Error('maxLines must be greater than zero');

  const collected = collectFileLines(content);
  if (collected.length === 0 || anchorLine > collected.length) {
    throw new Error('anchorLine exceeds file length');
  }

  const anchorIndex = anchorLine - 1;
  const effectiveIndents = computeEffectiveIndents(collected);
  const anchorIndent = effectiveIndents[anchorIndex];

  const minIndent =
    options.maxLevels === 0 ? 0 : Math.max(0, anchorIndent - options.maxLevels * TAB_WIDTH);

  const finalLimit = Math.min(limit, guardLimit, collected.length);

  if (finalLimit === 1) {
    return [`L${collected[anchorIndex].number}: ${collected[anchorIndex].display}`];
  }

  // Cursors: i moves up, j moves down
  let i = anchorIndex - 1;
  let j = anchorIndex + 1;
  let iCounterMinIndent = 0;
  let jCounterMinIndent = 0;

  const out: LineRecord[] = [collected[anchorIndex]];

  while (out.length < finalLimit) {
    let progressed = 0;

    // Up
    if (i >= 0) {
      if (effectiveIndents[i] >= minIndent) {
        out.unshift(collected[i]);
        progressed++;
        i--;

        // Check siblings at min indent
        const iu = i + 1; // the line we just added (before decrement was i, now i+1)
        if (effectiveIndents[iu] === minIndent && !options.includeSiblings) {
          const allowHeaderComment = options.includeHeader && isComment(collected[iu]);
          const canTakeLine = allowHeaderComment || iCounterMinIndent === 0;

          if (canTakeLine) {
            iCounterMinIndent++;
          } else {
            out.shift();
            progressed--;
            i = -1; // stop moving up
          }
        }

        if (out.length >= finalLimit) break;
      } else {
        i = -1; // stop moving up
      }
    }

    // Down
    if (j < collected.length) {
      if (effectiveIndents[j] >= minIndent) {
        out.push(collected[j]);
        progressed++;
        j++;

        const ju = j - 1; // the line we just added
        if (effectiveIndents[ju] === minIndent && !options.includeSiblings) {
          if (jCounterMinIndent > 0) {
            out.pop();
            progressed--;
            j = collected.length; // stop moving down
          }
          jCounterMinIndent++;
        }
      } else {
        j = collected.length; // stop moving down
      }
    }

    if (progressed === 0) break;
  }

  return trimEmptyLines(out).map((record) => `L${record.number}: ${record.display}`);
}

// --- Public API ---

export interface ReadFileArgs {
  filePath: string;
  offset?: number;
  limit?: number;
  mode?: 'slice' | 'indentation';
  indentation?: Partial<IndentationArgs>;
}

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function readFileContent(content: string, args: ReadFileArgs): string {
  const offset = args.offset ?? 1;
  const limit = args.limit ?? 2000;
  const mode = args.mode ?? 'slice';

  if (offset === 0) throw new Error('offset must be a 1-indexed line number');
  if (limit === 0) throw new Error('limit must be greater than zero');

  if (mode === 'indentation') {
    const indentOpts: IndentationArgs = { ...DEFAULT_INDENTATION, ...args.indentation };
    return readBlock(content, offset, limit, indentOpts).join('\n');
  }
  return readSlice(content, offset, limit).join('\n');
}
