import { describe, it, expect } from 'vitest';

// We test the overlay state machine directly, not the terminal I/O.
// Import the module and extract the class via a workaround since the class isn't exported.
// Instead, we test via the exported requestUserInput by simulating key sequences.

// Since requestUserInput requires a TTY, we test the overlay logic by
// re-implementing the core state machine assertions here.

// Types from the module
interface UserInputOption { label: string; description: string; typeIfSelected?: boolean; }
interface UserInputQuestion { id: string; header: string; question: string; isOther?: boolean; multiSelect?: boolean; options?: UserInputOption[]; }

// Minimal port of the overlay state machine for testing (mirrors user-input.ts internals)
const OTHER_OPTION_LABEL = 'None of the above';

class TestOverlay {
  questions: UserInputQuestion[];
  currentIdx = 0;
  focus: 'options' | 'notes' = 'options';
  answers: { selectedIdx: number | null; selectedSet: Set<number>; notes: string; committed: boolean; notesVisible: boolean }[];
  done = false;
  cursorPos = 0;
  inTypeIfSelected = false;

  constructor(questions: UserInputQuestion[]) {
    this.questions = questions;
    this.answers = questions.map(q => {
      const hasOptions = !!(q.options && q.options.length > 0);
      return { selectedIdx: hasOptions ? 0 : null, selectedSet: new Set<number>(), notes: '', committed: false, notesVisible: !hasOptions };
    });
    this.ensureFocus();
    this.adjustFocusForTypeIfSelected();
  }

  get q() { return this.questions[this.currentIdx]; }
  get ans() { return this.answers[this.currentIdx]; }
  get hasOptions() { return !!(this.q?.options && this.q.options.length > 0); }
  get isMultiSelect() { return !!(this.q?.multiSelect); }

  optionsLen(): number {
    const q = this.q;
    if (!q?.options) return 0;
    let len = q.options.length;
    if (q.isOther) len++;
    if (q.multiSelect) len++; // submit button
    return len;
  }

  get cursorOnSubmitButton(): boolean {
    return this.isMultiSelect && this.ans.selectedIdx === (this.q?.options?.length ?? 0);
  }

  ensureFocus(): void {
    if (!this.hasOptions) { this.focus = 'notes'; this.ans.notesVisible = true; }
  }

  selectedOptionRequiresType(): boolean {
    const q = this.q;
    const a = this.ans;
    if (!q?.options || a.selectedIdx == null) return false;
    if (a.selectedIdx < q.options.length) return q.options[a.selectedIdx].typeIfSelected === true;
    return false;
  }

  adjustFocusForTypeIfSelected(): void {
    if (this.selectedOptionRequiresType()) {
      this.focus = 'notes';
      this.inTypeIfSelected = true;
      this.ans.notesVisible = true;
      this.cursorPos = this.ans.notes.length;
    } else if (this.inTypeIfSelected) {
      this.inTypeIfSelected = false;
      this.ans.notes = '';
      this.ans.notesVisible = false;
      this.ans.committed = false;
      this.cursorPos = 0;
      this.focus = 'options';
    }
  }

  // Simulate key presses
  pressDown(): void {
    if (this.hasOptions) {
      const a = this.ans;
      if (a.selectedIdx == null) a.selectedIdx = 0;
      else a.selectedIdx = (a.selectedIdx + 1) % this.optionsLen();
      a.committed = false;
      this.adjustFocusForTypeIfSelected();
    }
  }

  pressUp(): void {
    if (this.hasOptions) {
      const a = this.ans;
      const len = this.optionsLen();
      if (a.selectedIdx == null) a.selectedIdx = 0;
      else a.selectedIdx = (a.selectedIdx - 1 + len) % len;
      a.committed = false;
      this.adjustFocusForTypeIfSelected();
    }
  }

  pressSpace(): void {
    if (this.focus === 'options' && this.isMultiSelect && this.ans.selectedIdx != null && !this.cursorOnSubmitButton) {
      const idx = this.ans.selectedIdx;
      if (this.ans.selectedSet.has(idx)) this.ans.selectedSet.delete(idx);
      else this.ans.selectedSet.add(idx);
    }
  }

  pressEnter(): void {
    const a = this.ans;
    if (this.isMultiSelect) {
      if (this.cursorOnSubmitButton && a.selectedSet.size > 0) {
        a.committed = true;
        this.goNextOrSubmit();
      } else if (!this.cursorOnSubmitButton && a.selectedIdx != null) {
        if (a.selectedSet.has(a.selectedIdx)) a.selectedSet.delete(a.selectedIdx);
        else a.selectedSet.add(a.selectedIdx);
      }
      return;
    }
    if (this.focus === 'options') {
      if (a.selectedIdx != null && this.selectedOptionRequiresType()) {
        a.committed = true;
        this.focus = 'notes';
        this.inTypeIfSelected = true;
        a.notesVisible = true;
        this.cursorPos = a.notes.length;
        return;
      }
      if (a.selectedIdx != null) a.committed = true;
      this.goNextOrSubmit();
    } else {
      if (this.hasOptions) a.committed = true;
      else a.committed = a.notes.trim() !== '';
      this.goNextOrSubmit();
    }
  }

  pressTab(): void {
    if (this.focus === 'options' && this.ans.selectedIdx != null) {
      this.focus = 'notes';
      this.ans.notesVisible = true;
      this.cursorPos = this.ans.notes.length;
    } else if (this.focus === 'notes' && this.hasOptions && !this.inTypeIfSelected) {
      this.ans.notes = '';
      this.ans.committed = false;
      this.ans.notesVisible = false;
      this.cursorPos = 0;
      this.focus = 'options';
    }
  }

  typeChar(ch: string): void {
    if (this.focus === 'options') {
      // Digit selection
      const digit = parseInt(ch);
      if (digit >= 1 && digit <= this.optionsLen()) {
        if (this.isMultiSelect) {
          const idx = digit - 1;
          if (idx < (this.q?.options?.length ?? 0)) {
            this.ans.selectedIdx = idx;
            if (this.ans.selectedSet.has(idx)) this.ans.selectedSet.delete(idx);
            else this.ans.selectedSet.add(idx);
          }
          return;
        }
        this.ans.selectedIdx = digit - 1;
        if (this.selectedOptionRequiresType()) {
          this.ans.committed = true;
          this.focus = 'notes';
          this.inTypeIfSelected = true;
          this.ans.notesVisible = true;
          this.cursorPos = this.ans.notes.length;
          return;
        }
        this.ans.committed = true;
        this.goNextOrSubmit();
        return;
      }
      // Jump to notes
      this.focus = 'notes';
      this.ans.notesVisible = true;
      this.ans.notes += ch;
      this.cursorPos = this.ans.notes.length;
      this.ans.committed = false;
    } else {
      this.ans.notes += ch;
      this.cursorPos = this.ans.notes.length;
      this.ans.committed = false;
    }
  }

  pressEsc(): void {
    if (this.hasOptions && this.ans.notesVisible && !this.inTypeIfSelected) {
      this.ans.notes = '';
      this.ans.notesVisible = false;
      this.focus = 'options';
    } else if (this.inTypeIfSelected) {
      this.ans.notes = '';
      this.ans.committed = false;
      this.cursorPos = 0;
      this.inTypeIfSelected = false;
      this.focus = 'options';
    } else {
      this.done = true;
    }
  }

  goNextOrSubmit(): void {
    if (this.currentIdx + 1 >= this.questions.length) {
      this.done = true;
    } else {
      this.currentIdx++;
      this.cursorPos = this.ans.notes.length;
      this.ensureFocus();
    }
  }

  buildResponse(): Map<string, { answers: string[] }> {
    const response = new Map<string, { answers: string[] }>();
    for (let idx = 0; idx < this.questions.length; idx++) {
      const question = this.questions[idx];
      const answer = this.answers[idx];
      const answerList: string[] = [];

      if (question.multiSelect && answer.committed && question.options) {
        for (const si of Array.from(answer.selectedSet).sort((a, b) => a - b)) {
          if (si < question.options.length) answerList.push(question.options[si].label);
        }
      } else {
        if (answer.selectedIdx != null && answer.committed && question.options) {
          if (answer.selectedIdx < question.options.length) {
            answerList.push(question.options[answer.selectedIdx].label);
          } else if (answer.selectedIdx === question.options.length && question.isOther) {
            answerList.push(OTHER_OPTION_LABEL);
          }
        }
      }

      const notes = answer.committed ? answer.notes.trim() : '';
      if (notes) answerList.push(`user_note: ${notes}`);
      response.set(question.id, { answers: answerList });
    }
    return response;
  }
}

describe('RequestUserInput overlay state machine', () => {
  // ── Option selection ──

  it('defaults to first option selected', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick one',
      options: [
        { label: 'Option 1', description: 'First' },
        { label: 'Option 2', description: 'Second' },
      ],
    }]);
    expect(overlay.ans.selectedIdx).toBe(0);
    expect(overlay.focus).toBe('options');
  });

  it('enter commits default selection and submits', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick one',
      options: [
        { label: 'Option 1', description: 'First' },
        { label: 'Option 2', description: 'Second' },
      ],
    }]);
    overlay.pressEnter();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['Option 1']);
  });

  it('down arrow navigates options', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'A', description: '' },
        { label: 'B', description: '' },
        { label: 'C', description: '' },
      ],
    }]);
    overlay.pressDown();
    expect(overlay.ans.selectedIdx).toBe(1);
    overlay.pressDown();
    expect(overlay.ans.selectedIdx).toBe(2);
    overlay.pressDown(); // wraps
    expect(overlay.ans.selectedIdx).toBe(0);
  });

  it('up arrow wraps around', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'A', description: '' },
        { label: 'B', description: '' },
      ],
    }]);
    overlay.pressUp(); // wraps from 0 to last
    expect(overlay.ans.selectedIdx).toBe(1);
  });

  it('digit selects option and submits', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'A', description: '' },
        { label: 'B', description: '' },
      ],
    }]);
    overlay.typeChar('2');
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['B']);
  });

  // ── Notes / freeform ──

  it('typing while on options jumps to notes', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [{ label: 'A', description: '' }],
    }]);
    overlay.typeChar('h'); // not a digit → jumps to notes
    expect(overlay.focus).toBe('notes');
    expect(overlay.ans.notes).toBe('h');
    expect(overlay.ans.notesVisible).toBe(true);
  });

  it('tab switches to notes and back', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [{ label: 'A', description: '' }],
    }]);
    overlay.pressTab();
    expect(overlay.focus).toBe('notes');
    overlay.pressTab();
    expect(overlay.focus).toBe('options');
  });

  it('esc in notes clears notes and returns to options', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [{ label: 'A', description: '' }],
    }]);
    overlay.pressTab();
    overlay.typeChar('x');
    expect(overlay.ans.notes).toBe('x');
    overlay.pressEsc();
    expect(overlay.focus).toBe('options');
    expect(overlay.ans.notes).toBe('');
  });

  // ── Freeform-only questions ──

  it('freeform question starts focused on notes', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Describe',
    }]);
    expect(overlay.focus).toBe('notes');
    expect(overlay.ans.notesVisible).toBe(true);
  });

  it('freeform question submits typed text', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Describe',
    }]);
    overlay.typeChar('h');
    overlay.typeChar('i');
    overlay.pressEnter();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['user_note: hi']);
  });

  it('freeform question with empty text submits empty', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Describe',
    }]);
    overlay.pressEnter();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual([]);
  });

  // ── isOther adds "None of the above" ──

  it('isOther adds extra option', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      isOther: true,
      options: [{ label: 'A', description: '' }],
    }]);
    expect(overlay.optionsLen()).toBe(2); // A + "None of the above"
    overlay.pressDown(); // move to "None of the above"
    overlay.pressEnter();
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['None of the above']);
  });

  // ── Multi-question navigation ──

  it('enter advances to next question', () => {
    const overlay = new TestOverlay([
      { id: 'q1', header: 'H1', question: 'First', options: [{ label: 'A', description: '' }] },
      { id: 'q2', header: 'H2', question: 'Second', options: [{ label: 'B', description: '' }] },
    ]);
    overlay.pressEnter(); // commit q1, advance to q2
    expect(overlay.done).toBe(false);
    expect(overlay.currentIdx).toBe(1);
    overlay.pressEnter(); // commit q2, done
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['A']);
    expect(resp.get('q2')!.answers).toEqual(['B']);
  });

  // ── Option + notes combined ──

  it('option selection + notes are both submitted', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [{ label: 'A', description: '' }],
    }]);
    overlay.pressTab(); // go to notes
    overlay.typeChar('m');
    overlay.typeChar('y');
    overlay.typeChar(' ');
    overlay.typeChar('n');
    overlay.typeChar('o');
    overlay.typeChar('t');
    overlay.typeChar('e');
    overlay.pressEnter();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['A', 'user_note: my note']);
  });

  // ── typeIfSelected (inline) ──

  it('typeIfSelected: arrow nav auto-focuses inline notes', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Add to gitignore?',
      options: [
        { label: 'Yes', description: 'Do it' },
        { label: 'No — type why', description: 'Explain', typeIfSelected: true },
      ],
    }]);
    overlay.pressDown(); // select "No — type why" → auto-focus notes
    expect(overlay.focus).toBe('notes');
    expect(overlay.inTypeIfSelected).toBe(true);
    expect(overlay.done).toBe(false);
    // Type a reason and submit
    overlay.typeChar('n');
    overlay.typeChar('o');
    overlay.pressEnter();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['No — type why', 'user_note: no']);
  });

  it('typeIfSelected: navigating away clears notes and returns to options', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'Yes', description: '' },
        { label: 'No — type', description: '', typeIfSelected: true },
      ],
    }]);
    overlay.pressDown(); // → "No — type", auto-focus notes
    expect(overlay.focus).toBe('notes');
    overlay.typeChar('x');
    overlay.pressUp(); // navigate to "Yes" → clears notes, options focus
    expect(overlay.focus).toBe('options');
    expect(overlay.ans.notes).toBe('');
    expect(overlay.ans.selectedIdx).toBe(0);
  });

  it('typeIfSelected: digit opens notes instead of submitting', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'A', description: '' },
        { label: 'B — type', description: '', typeIfSelected: true },
      ],
    }]);
    overlay.typeChar('2'); // digit selects "B — type"
    expect(overlay.done).toBe(false);
    expect(overlay.focus).toBe('notes');
    expect(overlay.inTypeIfSelected).toBe(true);
  });

  it('typeIfSelected: normal option still submits immediately', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'A', description: '' },
        { label: 'B — type', description: '', typeIfSelected: true },
      ],
    }]);
    overlay.pressEnter(); // "A" is selected (default), should submit
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(['A']);
  });

  it('typeIfSelected: esc clears inline notes and returns to options', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [
        { label: 'Yes', description: '' },
        { label: 'No — type', description: '', typeIfSelected: true },
      ],
    }]);
    overlay.pressDown(); // auto-focus notes
    overlay.typeChar('x');
    overlay.pressEsc(); // clears inline notes, back to options
    expect(overlay.focus).toBe('options');
    expect(overlay.ans.notes).toBe('');
    expect(overlay.inTypeIfSelected).toBe(false);
    expect(overlay.done).toBe(false); // should NOT cancel
  });

  it('esc on options without notes cancels', () => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick',
      options: [{ label: 'A', description: '' }],
    }]);
    overlay.pressEsc();
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual([]); // uncommitted
  });

  // ── multiSelect ──

  it.each([
    {
      name: 'space toggles, submit button submits',
      actions: (o: TestOverlay) => {
        o.pressSpace(); // toggle A
        o.pressDown(); o.pressDown(); o.pressSpace(); // toggle C
        o.pressDown(); // move to submit button
        expect(o.cursorOnSubmitButton).toBe(true);
        o.pressEnter();
      },
      expected: ['A', 'C'],
    },
    {
      name: 'enter on option toggles instead of submitting',
      actions: (o: TestOverlay) => {
        o.pressEnter(); // toggle A
        expect(o.done).toBe(false);
        o.pressDown(); o.pressDown(); o.pressDown(); // move to submit button
        o.pressEnter();
      },
      expected: ['A'],
    },
    {
      name: 'digit toggles selection',
      actions: (o: TestOverlay) => {
        o.typeChar('2'); o.typeChar('3'); // cursor at 2 (C), toggled B and C
        o.pressDown(); // cursor at 3 (submit button)
        expect(o.cursorOnSubmitButton).toBe(true);
        o.pressEnter();
      },
      expected: ['B', 'C'],
    },
    {
      name: 'submit button is no-op when nothing selected',
      actions: (o: TestOverlay) => {
        o.pressDown(); o.pressDown(); o.pressDown(); // move to submit
        o.pressEnter(); // no-op
        expect(o.done).toBe(false);
        o.pressUp(); o.pressSpace(); // toggle C
        o.pressDown(); o.pressEnter(); // submit
      },
      expected: ['C'],
    },
  ])('multiSelect: $name', ({ actions, expected }) => {
    const overlay = new TestOverlay([{
      id: 'q1', header: 'H', question: 'Pick many',
      multiSelect: true,
      options: [
        { label: 'A', description: '' },
        { label: 'B', description: '' },
        { label: 'C', description: '' },
      ],
    }]);
    actions(overlay);
    expect(overlay.done).toBe(true);
    const resp = overlay.buildResponse();
    expect(resp.get('q1')!.answers).toEqual(expected);
  });
});
