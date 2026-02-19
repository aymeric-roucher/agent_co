import { describe, it, expect } from 'vitest';
import { buildVPPrompt } from '../src/vp/prompt.js';
import type { DepartmentConfig, CompanyConfig } from '../src/config.js';

const dept: DepartmentConfig = {
  slug: 'code-quality',
  name: 'Code Quality',
  description: 'Ensure all code meets quality standards',
};

const company: CompanyConfig = {
  repo: '/tmp/test-repo',
  worker_type: 'claude_code',
  departments: [dept],
};

describe('buildVPPrompt', () => {
  it('includes department name and description', () => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain('"Code Quality"');
    expect(prompt).toContain('Ensure all code meets quality standards');
  });

  it.each([
    'start_worker',
    'continue_worker',
    'kill_worker',
    'list_workers',
    'shell',
    'read_file',
    'mark_done',
    'open_pr',
  ])('mentions tool %s', (toolName) => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain(toolName);
  });

  it('includes Playwright screenshot instructions', () => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain('npx playwright screenshot');
    expect(prompt).toContain('--browser chromium');
  });

  it('includes knowledge management section', () => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain('VP_LOGS.md');
    expect(prompt).toContain('DOC.md');
    expect(prompt).toContain('DOC_COMMON.md');
    expect(prompt).toContain('WORK.md');
  });

  it('includes worker workflow steps', () => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain('approve or deny');
    expect(prompt).toContain('mark_done');
    expect(prompt).toContain('screenshots');
  });

  it('enforces strict standards', () => {
    const prompt = buildVPPrompt(dept, company);
    expect(prompt).toContain('No unnecessary abstractions');
    expect(prompt).toContain('fail loudly');
  });
});
