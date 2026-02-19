import { describe, it, expect } from 'vitest';
import { readFileContent, isImageFile } from '../src/vp/read-file.js';

// --- isImageFile ---

describe('isImageFile', () => {
  it.each([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  ])('returns true for %s', (ext) => {
    expect(isImageFile(`/path/to/file${ext}`)).toBe(true);
  });

  it.each([
    '.ts', '.html', '.css', '.md', '.json', '.yaml', '.txt',
  ])('returns false for %s', (ext) => {
    expect(isImageFile(`/path/to/file${ext}`)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isImageFile('/path/to/file.PNG')).toBe(true);
    expect(isImageFile('/path/to/file.Jpg')).toBe(true);
    expect(isImageFile('/path/to/file.SVG')).toBe(true);
  });

  it('handles paths with multiple dots', () => {
    expect(isImageFile('/path/to/my.file.png')).toBe(true);
    expect(isImageFile('/path/to/my.file.ts')).toBe(false);
  });
});

// --- slice mode ---

describe('readFileContent slice mode', () => {
  it('reads requested range', () => {
    const content = 'alpha\nbeta\ngamma\n';
    const result = readFileContent(content, { filePath: 'f', offset: 2, limit: 2 });
    expect(result).toBe('L2: beta\nL3: gamma');
  });

  it('defaults to offset=1 limit=2000', () => {
    const content = 'one\ntwo\nthree\n';
    const result = readFileContent(content, { filePath: 'f' });
    expect(result).toContain('L1: one');
    expect(result).toContain('L3: three');
  });

  it('errors when offset exceeds length', () => {
    expect(() => readFileContent('only\n', { filePath: 'f', offset: 3, limit: 1 }))
      .toThrow('offset exceeds file length');
  });

  it('errors when offset is 0', () => {
    expect(() => readFileContent('x\n', { filePath: 'f', offset: 0 }))
      .toThrow('offset must be a 1-indexed line number');
  });

  it('errors when limit is 0', () => {
    expect(() => readFileContent('x\n', { filePath: 'f', limit: 0 }))
      .toThrow('limit must be greater than zero');
  });

  it('respects limit even with more lines', () => {
    const content = 'first\nsecond\nthird\n';
    const result = readFileContent(content, { filePath: 'f', offset: 1, limit: 2 });
    expect(result).toBe('L1: first\nL2: second');
  });

  it('truncates lines longer than 500 chars', () => {
    const longLine = 'x'.repeat(550);
    const result = readFileContent(longLine + '\n', { filePath: 'f', offset: 1, limit: 1 });
    expect(result).toBe(`L1: ${'x'.repeat(500)}`);
  });

  it('handles CRLF endings', () => {
    const content = 'one\r\ntwo\r\n';
    const result = readFileContent(content, { filePath: 'f', offset: 1, limit: 2 });
    expect(result).toBe('L1: one\nL2: two');
  });

  it('reads single-line file without trailing newline', () => {
    const result = readFileContent('hello', { filePath: 'f', offset: 1, limit: 10 });
    expect(result).toBe('L1: hello');
  });

  it('throws on empty content (offset exceeds 0 lines)', () => {
    expect(() => readFileContent('', { filePath: 'f', offset: 1, limit: 10 }))
      .toThrow('offset exceeds file length');
  });

  it('reads last line when offset equals line count', () => {
    const content = 'a\nb\nc\n';
    const result = readFileContent(content, { filePath: 'f', offset: 3, limit: 10 });
    expect(result).toBe('L3: c');
  });
});

// --- indentation mode ---

describe('readFileContent indentation mode', () => {
  it('captures block around anchor', () => {
    const content = `fn outer() {
    if cond {
        inner();
    }
    tail();
}
`;
    const result = readFileContent(content, {
      filePath: 'f', offset: 3, limit: 10, mode: 'indentation',
      indentation: { anchorLine: 3, maxLevels: 1, includeSiblings: false, includeHeader: true },
    });
    expect(result).toBe('L2:     if cond {\nL3:         inner();\nL4:     }');
  });

  it('expands parents with maxLevels', () => {
    const content = `mod root {
    fn outer() {
        if cond {
            inner();
        }
    }
}
`;
    const result = readFileContent(content, {
      filePath: 'f', offset: 4, limit: 50, mode: 'indentation',
      indentation: { anchorLine: 4, maxLevels: 2, includeSiblings: false, includeHeader: true },
    });
    expect(result).toContain('L2:     fn outer() {');
    expect(result).toContain('L4:             inner();');
    expect(result).toContain('L6:     }');
  });

  it('respects include_siblings flag', () => {
    const content = `fn wrapper() {
    if first {
        do_first();
    }
    if second {
        do_second();
    }
}
`;
    const without = readFileContent(content, {
      filePath: 'f', offset: 3, limit: 50, mode: 'indentation',
      indentation: { anchorLine: 3, maxLevels: 1, includeSiblings: false, includeHeader: true },
    });
    expect(without).not.toContain('second');

    const withSiblings = readFileContent(content, {
      filePath: 'f', offset: 3, limit: 50, mode: 'indentation',
      indentation: { anchorLine: 3, maxLevels: 1, includeSiblings: true, includeHeader: true },
    });
    expect(withSiblings).toContain('L5:     if second {');
    expect(withSiblings).toContain('L6:         do_second();');
  });

  it('handles Python sample', () => {
    const content = `class Foo:
    def __init__(self, size):
        self.size = size
    def double(self, value):
        if value is None:
            return 0
        result = value * self.size
        return result
class Bar:
    def compute(self):
        helper = Foo(2)
        return helper.double(5)
`;
    const result = readFileContent(content, {
      filePath: 'f', offset: 1, limit: 200, mode: 'indentation',
      indentation: { anchorLine: 7, maxLevels: 1, includeSiblings: true, includeHeader: true },
    });
    expect(result).toContain('L2:     def __init__(self, size):');
    expect(result).toContain('L7:         result = value * self.size');
    expect(result).toContain('L8:         return result');
  });

  it('includes header comments', () => {
    const content = `#include <vector>
#include <string>

namespace sample {
class Runner {
public:
    void setup() {
        if (enabled_) {
            init();
        }
    }

    // Run the code
    int run() const {
        switch (mode_) {
            case Mode::Fast:
                return fast();
            case Mode::Slow:
                return slow();
            default:
                return fallback();
        }
    }
};
}
`;
    const result = readFileContent(content, {
      filePath: 'f', offset: 18, limit: 200, mode: 'indentation',
      indentation: { anchorLine: 18, maxLevels: 2, includeSiblings: false, includeHeader: true },
    });
    expect(result).toContain('L13:     // Run the code');
    expect(result).toContain('L14:     int run() const {');
    expect(result).toContain('L18:             case Mode::Slow:');
  });

  it('errors when anchorLine is 0', () => {
    expect(() => readFileContent('a\nb\n', {
      filePath: 'f', offset: 1, limit: 10, mode: 'indentation',
      indentation: { anchorLine: 0, maxLevels: 0, includeSiblings: false },
    })).toThrow('anchorLine must be a 1-indexed line number');
  });

  it('errors when anchorLine exceeds file length', () => {
    expect(() => readFileContent('one\ntwo\n', {
      filePath: 'f', offset: 1, limit: 10, mode: 'indentation',
      indentation: { anchorLine: 99, maxLevels: 0, includeSiblings: false },
    })).toThrow('anchorLine exceeds file length');
  });

  it('returns single line when limit is 1', () => {
    const content = 'first\nsecond\nthird\n';
    const result = readFileContent(content, {
      filePath: 'f', offset: 2, limit: 1, mode: 'indentation',
      indentation: { anchorLine: 2, maxLevels: 0, includeSiblings: false },
    });
    expect(result).toBe('L2: second');
  });
});
