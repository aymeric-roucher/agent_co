import { describe, it, expect } from 'vitest';
import { buildVPPrompt } from '../src/vp/prompt.js';
import type { DepartmentConfig, CompanyConfig } from '../src/config.js';

const dept: DepartmentConfig = { slug: 'testing', name: 'Quality', description: 'Ensure test coverage' };
const company: CompanyConfig = { repo: '/tmp/repo', worker_type: 'claude_code', departments: [dept] };

describe('buildVPPrompt', () => {
  const prompt = buildVPPrompt(dept, company);

  it('includes department name and description', () => {
    expect(prompt).toContain('Quality');
    expect(prompt).toContain('Ensure test coverage');
  });

  it.each([
    'start_worker', 'continue_worker', 'kill_worker', 'list_workers',
    'shell', 'read_file', 'mark_done', 'open_pr',
  ])('mentions tool %s', (toolName) => {
    expect(prompt).toContain(toolName);
  });

  it('includes knowledge management section', () => {
    expect(prompt).toContain('VP_LOGS.md');
    expect(prompt).toContain('DOC.md');
    expect(prompt).toContain('DOC_COMMON.md');
    expect(prompt).toContain('WORK.md');
  });

  it('includes Playwright screenshot workflow', () => {
    expect(prompt).toContain('playwright');
  });

  it('includes worker workflow steps', () => {
    expect(prompt).toContain('approve');
    expect(prompt).toContain('deny');
    expect(prompt).toContain('DONE');
  });
});
