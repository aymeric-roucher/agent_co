import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync, execSync } from 'child_process';
import path from 'path';
import { saveConfig, ensureDepartmentDirs, DEFAULT_MODEL, COMPANY_DIR, type DepartmentConfig } from './config.js';
import { requestUserInput, type UserInputQuestion } from './tui/user-input.js';

const ACCENT = '\x1b[38;2;43;201;124m';
const RESET = '\x1b[39m';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(msg: string): () => void {
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r${ACCENT}${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]}${RESET} ${msg}`);
  }, 80);
  return () => { clearInterval(id); process.stdout.write('\r\x1b[2K'); };
}

const VPDescriptionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
});

const ProposalSchema = z.object({
  departments: z.array(VPDescriptionSchema).min(2).max(10),
});

/** Walk up from cwd to find the user's coding agent instructions file. */
function findAgentInstructionsPath(workerType: 'claude_code' | 'codex'): string | null {
  const candidates = workerType === 'claude_code'
    ? ['CLAUDE.md', '.claude/CLAUDE.md']
    : ['AGENT.md'];
  const home = process.env.HOME ?? '/';
  let dir = process.cwd();
  while (true) {
    for (const candidate of candidates) {
      const p = path.join(dir, candidate);
      if (existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return null;
}

function addCompanyToGitignore(): void {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  if (content.includes('company/')) return;
  const sep = content === '' || content.endsWith('\n') ? '' : '\n';
  appendFileSync(gitignorePath, `${sep}company/\n`);
}

function getAnswer(response: Map<string, { answers: string[] }>, id: string): { selected: string | null; notes: string } {
  const entry = response.get(id);
  if (!entry || entry.answers.length === 0) return { selected: null, notes: '' };
  let selected: string | null = null;
  let notes = '';
  for (const a of entry.answers) {
    if (a.startsWith('user_note: ')) {
      notes = a.slice('user_note: '.length);
    } else {
      selected = a;
    }
  }
  return { selected, notes };
}

export async function runSecretary(): Promise<void> {
  console.log('Welcome to Agent Company setup!\n');

  // ── Step 1: Worker type + gitignore (single requestUserInput call) ──

  const setupResponse = await requestUserInput([
    {
      id: 'worker_type',
      header: 'Worker type',
      question: 'Which worker type should all departments use?',
      options: [
        { label: 'Claude Code (Recommended)', description: 'Claude Code CLI agents in subprocess mode.' },
        { label: 'Codex', description: 'OpenAI Codex CLI agents in subprocess mode.' },
      ],
    },
    {
      id: 'gitignore',
      header: 'Gitignore',
      question: 'Add company/ to .gitignore?',
      options: [
        { label: 'Yes (Recommended)', description: 'Prevents runtime data from being committed.' },
        { label: 'No', description: 'Closes setup.' },
      ],
    },
  ]);

  if (setupResponse.size === 0) process.exit(0);
  const workerTypeAnswer = getAnswer(setupResponse, 'worker_type');
  const workerType = workerTypeAnswer.selected?.includes('Codex') ? 'codex' as const : 'claude_code' as const;

  const gitignoreAnswer = getAnswer(setupResponse, 'gitignore');
  if (gitignoreAnswer.selected?.includes('No')) process.exit(0);
  const addGitignoreFlag = gitignoreAnswer.selected?.includes('Yes') ?? false;

  // ── Step 2: Areas — freeform question ──

  const areasResponse = await requestUserInput([
    {
      id: 'areas',
      header: 'Areas',
      question: 'What areas should your agents handle?',
      // No options → freeform only (from Codex: "Freeform-only questions")
    },
  ]);

  if (areasResponse.size === 0) process.exit(0);
  let description = getAnswer(areasResponse, 'areas').notes;
  if (!description) {
    console.log('\nNo areas described. Setup cancelled.');
    process.exit(0);
  }

  // ── Step 3: LLM proposes departments; user multiselects ──

  const stopSpinner = startSpinner('Generating departments...');
  const { object } = await generateObject({
    model: openai(DEFAULT_MODEL),
    schema: ProposalSchema,
    prompt: `Propose a set of VP departments for an engineering team (up to 10).
Each VP needs: kebab-case slug, short name, and a description written in imperative second person addressed to the agent (e.g. "You own the full test suite. You ensure coverage stays above 90%." — NOT third person like "Manages testing").
The description should be a broad ongoing mandate (NOT a one-off task).
IMPORTANT: Use names and wording as close as possible to what the user wrote, unless you have a significantly clearer alternative.
NEVER use the word "agent" or "vp" in names or slugs — we already know they are agents and VPs. Use more department names (ofc no "department" either)

User description: ${description}`,
  });
  stopSpinner();

  const pickResponse = await requestUserInput([
    {
      id: 'pick',
      header: 'Departments',
      question: 'Select the departments you want to create.',
      multiSelect: true,
      options: object.departments.map(d => ({
        label: d.slug,
        description: `${d.name} — ${d.description}`,
      })),
    },
  ]);

  if (pickResponse.size === 0) process.exit(0);
  const picked = pickResponse.get('pick');
  const selectedSlugs = new Set(picked?.answers ?? []);
  const departments = object.departments.filter(d => selectedSlugs.has(d.slug));

  // ── Step 4: Save ──

  if (departments.length === 0) {
    console.log('\nNo departments created.');
    process.exit(0);
  }

  const config = { repo: process.cwd(), worker_type: workerType, departments };
  saveConfig(config);
  ensureDepartmentDirs(config);
  if (addGitignoreFlag) addCompanyToGitignore();

  // Write agent instructions file per department
  for (const dept of departments) {
    const deptDir = path.join(COMPANY_DIR, 'workspaces', dept.slug);
    const agentMd = [
      `# Your department: ${dept.name}`,
      '',
      `You are a rigorous VP in charge of the ${dept.name} department.`,
      '',
      dept.description,
      '',
      '## How work progresses',
      '',
      '1. You receive tasks from the event queue or decide on work based on your mandate.',
      '2. You spawn workers on dedicated branches — one focused task per worker.',
      '3. When a worker finishes, you review its output. Kill and replace underperformers.',
      '4. You persist learnings into DOC.md and progress into WORK.md.',
      '5. When work is ready and tested, you open a PR.',
    ].join('\n');
    writeFileSync(path.join(deptDir, 'AGENT.md'), agentMd + '\n');
  }

  // ── Step 5: Worker authentication (runs before summary so its output doesn't erase it) ──

  const bin = workerType === 'claude_code' ? 'claude' : 'codex';
  try {
    execSync(`which ${bin}`, { stdio: 'pipe' });
    const authCmd = workerType === 'claude_code' ? 'claude setup-token' : 'codex auth';
    console.log(`\nRunning "${authCmd}" to authenticate...`);
    spawnSync(authCmd.split(' ')[0], authCmd.split(' ').slice(1), { stdio: 'inherit' });
  } catch {
    console.log(`\nWarning: "${bin}" not found in PATH. Install it before running VPs.`);
  }

  // ── Summary (printed last so it stays visible) ──

  console.log(`\n${ACCENT}Setup complete!${RESET} ${departments.length} departments created:\n`);
  for (const dept of departments) {
    console.log(`  ${ACCENT}●${RESET} ${dept.name}  ${'\x1b[2m'}vp start ${dept.slug}${'\x1b[22m'}`);
  }

  const instructionsPath = findAgentInstructionsPath(workerType);
  if (instructionsPath) {
    console.log(`\nDetected coding agent instructions at ${ACCENT}${instructionsPath}${RESET}`);
    console.log('These will be used by workers automatically.');
  }

  console.log(`\nExplore ${ACCENT}company/${RESET} to see configs, agent instructions, and logs.\n`);
  process.exit(0);
}
