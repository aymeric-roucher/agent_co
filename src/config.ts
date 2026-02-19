import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import path from 'path';

const DepartmentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
});

const CompanyConfigSchema = z.object({
  repo: z.string(),
  worker_type: z.enum(['claude_code', 'codex']),
  departments: z.array(DepartmentSchema),
});

export type DepartmentConfig = z.infer<typeof DepartmentSchema>;
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

export const DEFAULT_MODEL = 'gpt-4o';
export const COMPANY_DIR = 'company';
export const CONFIG_PATH = path.join(COMPANY_DIR, 'config.yaml');

export function loadConfig(configPath = CONFIG_PATH): CompanyConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(`Config file not found: ${configPath}. Run 'vp setup' first.`);
  }
  const parsed = parse(raw);
  const result = CompanyConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config in ${configPath}:\n${issues}`);
  }
  return result.data;
}

export function saveConfig(config: CompanyConfig, configPath = CONFIG_PATH): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringify(config));
}

export function ensureDepartmentDirs(config: CompanyConfig): void {
  for (const dept of config.departments) {
    const deptDir = path.join(COMPANY_DIR, 'workspaces', dept.slug);
    mkdirSync(path.join(deptDir, 'plans'), { recursive: true });
    mkdirSync(path.join(deptDir, 'prds'), { recursive: true });
    const logsDir = path.join(COMPANY_DIR, 'logs', dept.slug, 'work-snapshots');
    mkdirSync(logsDir, { recursive: true });
  }
}
