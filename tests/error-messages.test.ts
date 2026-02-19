import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileContent } from '../src/vp/read-file.js';
import { loadConfig, saveConfig, type CompanyConfig } from '../src/config.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

const TMP = path.join(import.meta.dirname, '.tmp-error-messages-test');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

// --- cliError / requireDepartment (tested via config + index exports) ---

describe('config error messages', () => {
  it('includes file path in missing config error', () => {
    const fakePath = path.join(TMP, 'nope.yaml');
    expect(() => loadConfig(fakePath)).toThrow(`Config file not found: ${fakePath}`);
  });

  it('suggests running setup in missing config error', () => {
    expect(() => loadConfig(path.join(TMP, 'nope.yaml'))).toThrow("Run 'vp setup' first");
  });

  it.each([
    { yaml: 'departments: []\n', field: 'repo' },
    { yaml: 'repo: /tmp\nworker_type: bad\ndepartments: []\n', field: 'worker_type' },
  ])('includes field path "$field" in validation error', ({ yaml, field }) => {
    const configPath = path.join(TMP, `bad-${field}.yaml`);
    writeFileSync(configPath, yaml);
    expect(() => loadConfig(configPath)).toThrow(field);
  });

  it('prefixes validation errors with "Invalid config in <path>"', () => {
    const configPath = path.join(TMP, 'invalid.yaml');
    writeFileSync(configPath, 'departments: []\n');
    expect(() => loadConfig(configPath)).toThrow(`Invalid config in ${configPath}`);
  });
});

// --- read-file error messages include context ---

describe('read-file error messages', () => {
  const threeLines = 'a\nb\nc\n';

  it.each([
    { offset: 5, limit: 1, expected: 'Offset 5 exceeds file length (3 lines)' },
    { offset: 10, limit: 2, expected: 'Offset 10 exceeds file length (3 lines)' },
  ])('slice: offset=$offset gives "$expected"', ({ offset, limit, expected }) => {
    expect(() => readFileContent(threeLines, { filePath: 'f', offset, limit })).toThrow(expected);
  });

  it('slice: offset=0 error includes the value', () => {
    expect(() => readFileContent('x\n', { filePath: 'f', offset: 0 })).toThrow('got 0');
  });

  it('indentation: anchorLine=0 error includes the value', () => {
    expect(() => readFileContent('x\n', {
      filePath: 'f', offset: 1, limit: 10, mode: 'indentation',
      indentation: { anchorLine: 0, maxLevels: 0, includeSiblings: false, includeHeader: true },
    })).toThrow('got 0');
  });

  it('indentation: anchorLine exceeding length includes both values', () => {
    expect(() => readFileContent('a\nb\n', {
      filePath: 'f', offset: 1, limit: 10, mode: 'indentation',
      indentation: { anchorLine: 5, maxLevels: 0, includeSiblings: false, includeHeader: true },
    })).toThrow('Anchor line 5 exceeds file length (2 lines)');
  });

  it('indentation: maxLines=0 error is clear', () => {
    expect(() => readFileContent('a\nb\n', {
      filePath: 'f', offset: 1, limit: 10, mode: 'indentation',
      indentation: { maxLines: 0, maxLevels: 0, includeSiblings: false, includeHeader: true },
    })).toThrow('Max lines must be greater than zero');
  });
});

