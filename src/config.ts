import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import path from 'path';

const DepartmentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  responsibility: z.string(),
});

const CompanyConfigSchema = z.object({
  repo: z.string(),
  worker_type: z.enum(['claude_code', 'codex']),
  departments: z.array(DepartmentSchema),
});

export type DepartmentConfig = z.infer<typeof DepartmentSchema>;
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

export const COMPANY_DIR = 'company';
export const CONFIG_PATH = path.join(COMPANY_DIR, 'config.yaml');

export function loadConfig(configPath = CONFIG_PATH): CompanyConfig {
  const raw = readFileSync(configPath, 'utf-8');
  return CompanyConfigSchema.parse(parse(raw));
}

export function saveConfig(config: CompanyConfig, configPath = CONFIG_PATH): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringify(config));
}

export function ensureDepartmentDirs(config: CompanyConfig): void {
  for (const dept of config.departments) {
    const deptDir = path.join(COMPANY_DIR, 'departments', dept.slug);
    mkdirSync(path.join(deptDir, 'plans'), { recursive: true });
    mkdirSync(path.join(deptDir, 'prds'), { recursive: true });
    const logsDir = path.join(COMPANY_DIR, 'logs', dept.slug, 'work-snapshots');
    mkdirSync(logsDir, { recursive: true });
  }
}
