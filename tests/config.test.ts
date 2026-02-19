import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { loadConfig, saveConfig, ensureDepartmentDirs, COMPANY_DIR, type CompanyConfig } from '../src/config.js';
import path from 'path';

const TMP = path.join(import.meta.dirname, '.tmp-config-test');

const validConfig: CompanyConfig = {
  repo: '/tmp/test-repo',
  worker_type: 'claude_code',
  departments: [
    { slug: 'code-quality', name: 'Code Quality', description: 'Keep code clean' },
    { slug: 'ui', name: 'UI Fidelity', description: 'Match designs' },
  ],
};

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('config', () => {
  it('saves and loads a valid config', () => {
    const configPath = path.join(TMP, 'config.yaml');
    saveConfig(validConfig, configPath);
    const loaded = loadConfig(configPath);
    expect(loaded).toEqual(validConfig);
  });

  it('throws on invalid config (missing repo)', () => {
    const configPath = path.join(TMP, 'bad.yaml');
    writeFileSync(configPath, 'departments: []\n');
    expect(() => loadConfig(configPath)).toThrow();
  });

  it('throws on invalid worker_type', () => {
    const configPath = path.join(TMP, 'bad2.yaml');
    writeFileSync(configPath, 'repo: /tmp\nworker_type: invalid\ndepartments:\n  - slug: x\n    name: X\n    description: y\n');
    expect(() => loadConfig(configPath)).toThrow();
  });

  it('throws on non-existent file', () => {
    expect(() => loadConfig(path.join(TMP, 'nope.yaml'))).toThrow();
  });

  it('accepts codex worker_type', () => {
    const configPath = path.join(TMP, 'codex.yaml');
    const codexConfig: CompanyConfig = { ...validConfig, worker_type: 'codex' };
    saveConfig(codexConfig, configPath);
    expect(loadConfig(configPath).worker_type).toBe('codex');
  });

  it('saveConfig creates parent directories', () => {
    const configPath = path.join(TMP, 'deep', 'nested', 'config.yaml');
    saveConfig(validConfig, configPath);
    expect(existsSync(configPath)).toBe(true);
  });

  it('throws on missing department fields', () => {
    const configPath = path.join(TMP, 'bad-dept.yaml');
    writeFileSync(configPath, 'repo: /tmp\nworker_type: claude_code\ndepartments:\n  - slug: x\n');
    expect(() => loadConfig(configPath)).toThrow();
  });
});
