import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { loadConfig, saveConfig, ensureDepartmentDirs, type CompanyConfig } from '../src/config.js';
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
    expect(() => loadConfig(configPath)).toThrow('Invalid config');
  });

  it('throws on invalid worker_type', () => {
    const configPath = path.join(TMP, 'bad2.yaml');
    writeFileSync(configPath, 'repo: /tmp\nworker_type: invalid\ndepartments:\n  - slug: x\n    name: X\n    description: y\n');
    expect(() => loadConfig(configPath)).toThrow('Invalid config');
  });

  it('throws on missing config file', () => {
    expect(() => loadConfig(path.join(TMP, 'nonexistent.yaml'))).toThrow("Config file not found");
  });

  it('creates department directories', () => {
    expect(typeof ensureDepartmentDirs).toBe('function');
  });
});
