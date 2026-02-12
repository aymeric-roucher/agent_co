import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import path from 'path';
import { saveConfig, ensureDepartmentDirs, type DepartmentConfig } from './config.js';
import { requestUserInput, type UserInputQuestion } from './tui/user-input.js';

const DepartmentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  responsibility: z.string(),
});

const ProposalSchema = z.object({
  options: z.array(z.object({
    label: z.string(),
    departments: z.array(DepartmentSchema),
  })).min(2).max(4),
});

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
      ],
      isOther: true,
    },
  ]);

  const workerTypeAnswer = getAnswer(setupResponse, 'worker_type');
  const workerType = workerTypeAnswer.selected?.includes('Codex') ? 'codex' as const : 'claude_code' as const;

  const gitignoreAnswer = getAnswer(setupResponse, 'gitignore');
  const addGitignoreFlag = gitignoreAnswer.selected?.includes('Yes') ?? false;
  if (!addGitignoreFlag && gitignoreAnswer.notes) {
    console.log(`  Skipping .gitignore (${gitignoreAnswer.notes})`);
  }

  // ── Step 2: Areas — freeform question ──

  const areasResponse = await requestUserInput([
    {
      id: 'areas',
      header: 'Areas',
      question: 'What areas should your agents handle?',
      // No options → freeform only (from Codex: "Freeform-only questions")
    },
  ]);

  let description = getAnswer(areasResponse, 'areas').notes;
  if (!description) {
    console.log('\nNo areas described. Setup cancelled.');
    return;
  }

  // ── Step 3: LLM proposes department lists; user picks or refines ──

  let departments: DepartmentConfig[] = [];

  while (true) {
    console.log('\nGenerating proposals...');
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: ProposalSchema,
      prompt: `Propose 2-3 different department configurations for an engineering team.
Each option is a complete list of departments. Vary the granularity (e.g. one option with fewer broad depts, another with more focused ones).
Each department needs: kebab-case slug, short name, broad ongoing responsibility (NOT a one-off task).

User description: ${description}`,
    });

    // Build options from LLM proposals
    const options = object.options.map(opt => ({
      label: opt.label,
      description: opt.departments.map(d => `${d.name} (${d.slug})`).join(', '),
    }));

    // Show full details before the selection UI
    for (const [i, opt] of object.options.entries()) {
      console.log(`\n  [${i + 1}] ${opt.label}`);
      for (const d of opt.departments) {
        console.log(`      ${d.name} (${d.slug}) — ${d.responsibility}`);
      }
    }

    const pickResponse = await requestUserInput([
      {
        id: 'pick',
        header: 'Configuration',
        question: 'Pick a department configuration, or type something to refine.',
        isOther: true,
        options,
      },
    ]);

    const pick = getAnswer(pickResponse, 'pick');

    // If user typed something (notes), use that as new description
    if (pick.selected === 'None of the above' || (!pick.selected && pick.notes)) {
      description = pick.notes || description;
      continue;
    }

    // Find which option was selected
    const selectedIdx = options.findIndex(o => o.label === pick.selected);
    if (selectedIdx >= 0) {
      departments = object.options[selectedIdx].departments;
      break;
    }

    // Fallback: if notes provided, refine
    if (pick.notes) {
      description = pick.notes;
      continue;
    }

    // Default to first option
    departments = object.options[0].departments;
    break;
  }

  // ── Step 4: Confirm each department ──

  const accepted: DepartmentConfig[] = [];
  const edits: { original: DepartmentConfig; feedback: string }[] = [];

  for (const dept of departments) {
    const confirmResponse = await requestUserInput([
      {
        id: 'confirm',
        header: dept.name,
        question: `${dept.name} (${dept.slug}) — ${dept.responsibility}`,
        isOther: true,
        options: [
          { label: 'Accept (Recommended)', description: 'Include this department.' },
          { label: 'Reject', description: 'Skip this department.' },
        ],
      },
    ]);

    const answer = getAnswer(confirmResponse, 'confirm');
    if (answer.selected?.includes('Accept')) {
      accepted.push(dept);
    } else if (answer.selected?.includes('Reject')) {
      // skip
    } else if (answer.notes) {
      edits.push({ original: dept, feedback: answer.notes });
    }
  }

  // ── Step 5: If any feedback, one LLM call to refine ──

  if (edits.length > 0) {
    const editPrompt = edits
      .map(e => `"${e.original.name}" (${e.original.slug}): ${e.original.responsibility}\nFeedback: ${e.feedback}`)
      .join('\n\n');

    console.log('\nRefining based on feedback...');
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: z.object({ departments: z.array(DepartmentSchema) }),
      prompt: `Refine these departments based on user feedback:\n\n${editPrompt}`,
    });

    for (const refined of object.departments) {
      const refineResponse = await requestUserInput([
        {
          id: 'confirm',
          header: refined.name,
          question: `${refined.name} (${refined.slug}) — ${refined.responsibility}`,
          options: [
            { label: 'Accept (Recommended)', description: 'Include this department.' },
            { label: 'Reject', description: 'Skip this department.' },
          ],
        },
      ]);
      const answer = getAnswer(refineResponse, 'confirm');
      if (answer.selected?.includes('Accept')) accepted.push(refined);
    }
  }

  // ── Step 6: Save ──

  if (accepted.length === 0) {
    console.log('\nNo departments created.');
    return;
  }

  const config = { repo: process.cwd(), worker_type: workerType, departments: accepted };
  saveConfig(config);
  ensureDepartmentDirs(config);
  if (addGitignoreFlag) addCompanyToGitignore();

  console.log(`\nSetup complete! ${accepted.length} departments created.`);
  console.log('Start a VP with: vp start <slug>');
}
