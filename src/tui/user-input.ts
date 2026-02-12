/**
 * Port of Codex's request_user_input TUI overlay.
 *
 * Core behaviors (from codex-rs/tui/src/bottom_pane/request_user_input/mod.rs):
 * - Each question can be answered by selecting one option and/or providing notes.
 * - Notes are stored per question and appended as extra answers.
 * - Typing while focused on options jumps into notes to keep freeform input fast.
 * - Enter advances to the next question; the last question submits all answers.
 * - Freeform-only questions submit an empty answer list when empty.
 */
import * as readline from 'readline';

// ── Types (matching codex-rs/codex-protocol/src/request_user_input.rs) ──

export interface UserInputOption {
  label: string;
  description: string;
  /** When true, selecting this option and pressing Enter opens notes input instead of submitting. */
  typeIfSelected?: boolean;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  multiSelect?: boolean;
  options?: UserInputOption[];
}

export interface UserInputAnswer {
  answers: string[];
}

export type UserInputResponse = Map<string, UserInputAnswer>;

// ── ANSI helpers ──

const CSI = '\x1b[';
const ansi = {
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  clearScreen: `${CSI}2J${CSI}H`,
  clearLine: `${CSI}2K`,
  reset: `${CSI}0m`,
  dim: (s: string) => `${CSI}2m${s}${CSI}22m`,
  accent: (s: string) => `${CSI}38;2;43;201;124m${s}${CSI}39m`,
  bold: (s: string) => `${CSI}1m${s}${CSI}22m`,
  boldAccent: (s: string) => `${CSI}1;38;2;43;201;124m${s}${CSI}22;39m`,
  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
};

const write = (s: string) => process.stdout.write(s);

// ── Constants (from Codex mod.rs) ──

const NOTES_PLACEHOLDER = 'Add notes';
const ANSWER_PLACEHOLDER = 'Type your answer (optional)';
const SELECT_OPTION_PLACEHOLDER = 'Select an option to add notes';
const OTHER_OPTION_LABEL = 'None of the above';
const OTHER_OPTION_DESCRIPTION = 'Optionally, add details in notes (tab).';

// ── Per-question answer state ──

interface AnswerState {
  selectedIdx: number | null;
  selectedSet: Set<number>; // for multiSelect
  notes: string;
  committed: boolean;
  notesVisible: boolean;
}

// ── Focus ──

type Focus = 'options' | 'notes';

// ── Overlay (port of RequestUserInputOverlay) ──

class RequestUserInputOverlay {
  private questions: UserInputQuestion[];
  private currentIdx = 0;
  private focus: Focus = 'options';
  private answers: AnswerState[];
  private done = false;
  private cursorPos = 0; // cursor position within notes text
  private inTypeIfSelected = false; // true when focus was auto-set to notes for typeIfSelected
  private scrollOffset = 0; // first visible option index for scrollable lists

  constructor(questions: UserInputQuestion[]) {
    this.questions = questions;
    this.answers = questions.map(q => {
      const hasOptions = !!(q.options && q.options.length > 0);
      return {
        selectedIdx: hasOptions ? 0 : null,
        selectedSet: new Set(),
        notes: '',
        committed: false,
        notesVisible: !hasOptions,
      };
    });
    this.ensureFocusAvailable();
    this.adjustFocusForTypeIfSelected();
  }

  // ── Accessors ──

  private get q(): UserInputQuestion | undefined {
    return this.questions[this.currentIdx];
  }

  private get ans(): AnswerState | undefined {
    return this.answers[this.currentIdx];
  }

  private get hasOptions(): boolean {
    return !!(this.q?.options && this.q.options.length > 0);
  }

  private get isMultiSelect(): boolean {
    return !!(this.q?.multiSelect);
  }

  private optionsLen(): number {
    const q = this.q;
    if (!q?.options) return 0;
    let len = q.options.length;
    if (q.isOther) len++;
    if (q.multiSelect) len++; // submit button
    return len;
  }

  private get cursorOnSubmitButton(): boolean {
    return this.isMultiSelect && this.ans?.selectedIdx === (this.q?.options?.length ?? 0);
  }

  /** Check if the currently selected option requires typing (typeIfSelected). */
  private selectedOptionRequiresType(): boolean {
    const q = this.q;
    const a = this.ans;
    if (!q?.options || a?.selectedIdx == null) return false;
    if (a.selectedIdx < q.options.length) {
      return q.options[a.selectedIdx].typeIfSelected === true;
    }
    return false;
  }

  private notesUIVisible(): boolean {
    if (!this.hasOptions) return true;
    if (this.selectedOptionRequiresType()) return false; // inline, not separate area
    const a = this.ans;
    return !!(a && (a.notesVisible || a.notes.trim()));
  }

  private notesPlaceholder(): string {
    if (this.hasOptions && this.ans?.selectedIdx == null) return SELECT_OPTION_PLACEHOLDER;
    if (this.hasOptions) return NOTES_PLACEHOLDER;
    return ANSWER_PLACEHOLDER;
  }

  // ── Focus management (from Codex ensure_focus_available) ──

  private ensureFocusAvailable(): void {
    if (!this.hasOptions) {
      this.focus = 'notes';
      if (this.ans) this.ans.notesVisible = true;
      return;
    }
    if (this.focus === 'notes' && !this.notesUIVisible()) {
      this.focus = 'options';
    }
  }

  /** Auto-focus notes when navigating to a typeIfSelected option, clear when leaving. */
  private adjustFocusForTypeIfSelected(): void {
    if (this.selectedOptionRequiresType()) {
      this.focus = 'notes';
      this.inTypeIfSelected = true;
      const a = this.ans;
      if (a) {
        a.notesVisible = true;
        this.cursorPos = a.notes.length;
      }
    } else if (this.inTypeIfSelected) {
      this.inTypeIfSelected = false;
      const a = this.ans;
      if (a) {
        a.notes = '';
        a.notesVisible = false;
        a.committed = false;
      }
      this.cursorPos = 0;
      this.focus = 'options';
    }
  }

  // ── Option label for index (from Codex option_label_for_index) ──

  private optionLabelForIndex(idx: number): string | null {
    const q = this.q;
    if (!q?.options) return null;
    if (idx < q.options.length) return q.options[idx].label;
    if (idx === q.options.length && q.isOther) return OTHER_OPTION_LABEL;
    return null;
  }

  // ── Navigation (from Codex move_question) ──

  private moveQuestion(next: boolean): void {
    const len = this.questions.length;
    if (len === 0) return;
    const offset = next ? 1 : len - 1;
    this.currentIdx = (this.currentIdx + offset) % len;
    this.cursorPos = this.ans?.notes.length ?? 0;
    this.ensureFocusAvailable();
  }

  // ── Selection (from Codex select_current_option, clear_selection) ──

  private selectCurrentOption(committed: boolean): void {
    if (!this.hasOptions) return;
    const a = this.ans;
    if (!a) return;
    if (a.selectedIdx != null && a.selectedIdx >= this.optionsLen()) {
      a.selectedIdx = this.optionsLen() - 1;
    }
    a.committed = committed;
  }

  private clearSelection(): void {
    if (!this.hasOptions) return;
    const a = this.ans;
    if (!a) return;
    a.selectedIdx = null;
    a.notes = '';
    a.committed = false;
    a.notesVisible = false;
    this.cursorPos = 0;
  }

  private clearNotesAndFocusOptions(): void {
    if (!this.hasOptions) return;
    const a = this.ans;
    if (a) {
      a.notes = '';
      a.committed = false;
      a.notesVisible = false;
    }
    this.cursorPos = 0;
    this.focus = 'options';
  }

  // ── Submit (from Codex submit_answers) ──

  private buildResponse(): UserInputResponse {
    const response: UserInputResponse = new Map();
    for (let idx = 0; idx < this.questions.length; idx++) {
      const question = this.questions[idx];
      const answer = this.answers[idx];
      const answerList: string[] = [];

      if (question.multiSelect && answer.committed && question.options) {
        for (const si of Array.from(answer.selectedSet).sort((a, b) => a - b)) {
          if (si < question.options.length) answerList.push(question.options[si].label);
        }
      } else {
        const selectedIdx =
          question.options && question.options.length > 0 && answer.committed
            ? answer.selectedIdx
            : null;
        if (selectedIdx != null && question.options) {
          if (selectedIdx < question.options.length) {
            answerList.push(question.options[selectedIdx].label);
          } else if (selectedIdx === question.options.length && question.isOther) {
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

  private goNextOrSubmit(): void {
    if (this.currentIdx + 1 >= this.questions.length) {
      this.done = true;
    } else {
      this.moveQuestion(true);
    }
  }

  // ── Key handling (from Codex handle_key_event) ──

  handleKey(key: readline.Key & { sequence?: string }): void {
    const name = key.name;
    const ctrl = key.ctrl;
    const ch = key.sequence ?? '';

    // Esc
    if (name === 'escape') {
      if (this.hasOptions && this.notesUIVisible()) {
        this.clearNotesAndFocusOptions();
        return;
      }
      if (this.inTypeIfSelected) {
        const a = this.ans;
        if (a) { a.notes = ''; a.committed = false; }
        this.cursorPos = 0;
        this.inTypeIfSelected = false;
        this.focus = 'options';
        return;
      }
      // Interrupt — cancel
      this.done = true;
      return;
    }

    // Question navigation: Ctrl+P / Ctrl+N / PageUp / PageDown
    if ((ctrl && name === 'p') || name === 'pageup') {
      this.moveQuestion(false);
      return;
    }
    if ((ctrl && name === 'n') || name === 'pagedown') {
      this.moveQuestion(true);
      return;
    }

    // Left/Right navigate questions when on options
    if (this.hasOptions && this.focus === 'options') {
      if (name === 'left') { this.moveQuestion(false); return; }
      if (name === 'right') { this.moveQuestion(true); return; }
    }

    if (this.focus === 'options') {
      this.handleOptionsKey(key, ch);
    } else {
      this.handleNotesKey(key, ch);
    }
  }

  private handleOptionsKey(key: readline.Key, ch: string): void {
    const name = key.name;
    const optionsLen = this.optionsLen();
    const a = this.ans;
    if (!a) return;

    switch (name) {
      case 'up': {
        if (a.selectedIdx == null) a.selectedIdx = 0;
        else a.selectedIdx = (a.selectedIdx - 1 + optionsLen) % optionsLen;
        a.committed = false;
        this.adjustFocusForTypeIfSelected();
        return;
      }
      case 'down': {
        if (a.selectedIdx == null) a.selectedIdx = 0;
        else a.selectedIdx = (a.selectedIdx + 1) % optionsLen;
        a.committed = false;
        this.adjustFocusForTypeIfSelected();
        return;
      }
      case 'space': {
        if (this.isMultiSelect && a.selectedIdx != null && !this.cursorOnSubmitButton) {
          if (a.selectedSet.has(a.selectedIdx)) a.selectedSet.delete(a.selectedIdx);
          else a.selectedSet.add(a.selectedIdx);
        } else if (!this.isMultiSelect) {
          this.selectCurrentOption(true);
        }
        return;
      }
      case 'backspace':
      case 'delete': {
        this.clearSelection();
        return;
      }
      case 'tab': {
        if (a.selectedIdx != null) {
          this.focus = 'notes';
          a.notesVisible = true;
          this.cursorPos = a.notes.length;
        }
        return;
      }
      case 'return': {
        if (this.isMultiSelect) {
          if (this.cursorOnSubmitButton && a.selectedSet.size > 0) {
            a.committed = true;
            this.goNextOrSubmit();
          } else if (!this.cursorOnSubmitButton && a.selectedIdx != null) {
            // Enter on an option toggles it
            if (a.selectedSet.has(a.selectedIdx)) a.selectedSet.delete(a.selectedIdx);
            else a.selectedSet.add(a.selectedIdx);
          }
          return;
        }
        // If the selected option has typeIfSelected, open notes instead of submitting
        if (a.selectedIdx != null && this.selectedOptionRequiresType()) {
          this.selectCurrentOption(true);
          this.focus = 'notes';
          this.inTypeIfSelected = true;
          a.notesVisible = true;
          this.cursorPos = a.notes.length;
          return;
        }
        if (a.selectedIdx != null) {
          this.selectCurrentOption(true);
        }
        this.goNextOrSubmit();
        return;
      }
      default: {
        // Digit selection (from Codex option_index_for_digit)
        const digit = parseInt(ch);
        if (digit >= 1 && digit <= optionsLen) {
          if (this.isMultiSelect) {
            const idx = digit - 1;
            if (idx < (this.q?.options?.length ?? 0)) {
              a.selectedIdx = idx;
              if (a.selectedSet.has(idx)) a.selectedSet.delete(idx);
              else a.selectedSet.add(idx);
            }
            return;
          }
          a.selectedIdx = digit - 1;
          // If typeIfSelected, open notes instead of submitting
          if (this.selectedOptionRequiresType()) {
            this.selectCurrentOption(true);
            this.focus = 'notes';
            this.inTypeIfSelected = true;
            a.notesVisible = true;
            this.cursorPos = a.notes.length;
            return;
          }
          this.selectCurrentOption(true);
          this.goNextOrSubmit();
          return;
        }
        // Any other character: jump to notes (from Codex: "Typing while focused on options
        // switches into notes automatically to reduce friction for freeform input")
        if (ch && ch.length === 1 && ch >= ' ') {
          this.focus = 'notes';
          a.notesVisible = true;
          a.notes += ch;
          this.cursorPos = a.notes.length;
          a.committed = false;
        }
      }
    }
  }

  private handleNotesKey(key: readline.Key, ch: string): void {
    const name = key.name;
    const a = this.ans;
    if (!a) return;
    const notesEmpty = a.notes.trim() === '';

    // Tab: clear notes and focus options (from Codex)
    if (this.hasOptions && name === 'tab' && !this.inTypeIfSelected) {
      this.clearNotesAndFocusOptions();
      return;
    }

    // Backspace on empty notes: go back to options (from Codex)
    if (this.hasOptions && name === 'backspace' && notesEmpty && !this.inTypeIfSelected) {
      a.notesVisible = false;
      this.focus = 'options';
      return;
    }

    // Enter: commit and advance (from Codex)
    if (name === 'return') {
      if (this.hasOptions) {
        this.selectCurrentOption(true);
      } else {
        a.committed = a.notes.trim() !== '';
      }
      this.goNextOrSubmit();
      return;
    }

    // Up/Down in notes with options: navigate options (from Codex)
    if (this.hasOptions && (name === 'up' || name === 'down')) {
      const optionsLen = this.optionsLen();
      if (name === 'up') {
        if (a.selectedIdx == null) a.selectedIdx = 0;
        else a.selectedIdx = (a.selectedIdx - 1 + optionsLen) % optionsLen;
      } else {
        if (a.selectedIdx == null) a.selectedIdx = 0;
        else a.selectedIdx = (a.selectedIdx + 1) % optionsLen;
      }
      a.committed = false;
      this.adjustFocusForTypeIfSelected();
      return;
    }

    // Text editing
    if (name === 'backspace') {
      if (key.meta || ch === '\x1b\x7f') {
        // Option+Backspace: delete previous word
        let p = this.cursorPos;
        while (p > 0 && a.notes[p - 1] === ' ') p--;
        while (p > 0 && a.notes[p - 1] !== ' ') p--;
        a.notes = a.notes.slice(0, p) + a.notes.slice(this.cursorPos);
        this.cursorPos = p;
        a.committed = false;
      } else if (this.cursorPos > 0) {
        a.notes = a.notes.slice(0, this.cursorPos - 1) + a.notes.slice(this.cursorPos);
        this.cursorPos--;
        a.committed = false;
      }
      return;
    }
    if (name === 'delete') {
      if (this.cursorPos < a.notes.length) {
        a.notes = a.notes.slice(0, this.cursorPos) + a.notes.slice(this.cursorPos + 1);
        a.committed = false;
      }
      return;
    }
    if (name === 'left') {
      if (key.meta) {
        // Option+Left: jump to previous word boundary
        let p = this.cursorPos;
        while (p > 0 && a.notes[p - 1] === ' ') p--;
        while (p > 0 && a.notes[p - 1] !== ' ') p--;
        this.cursorPos = p;
      } else {
        if (this.cursorPos > 0) this.cursorPos--;
      }
      return;
    }
    if (name === 'right') {
      if (key.meta) {
        // Option+Right: jump to next word boundary
        let p = this.cursorPos;
        while (p < a.notes.length && a.notes[p] !== ' ') p++;
        while (p < a.notes.length && a.notes[p] === ' ') p++;
        this.cursorPos = p;
      } else {
        if (this.cursorPos < a.notes.length) this.cursorPos++;
      }
      return;
    }
    if (name === 'home' || (key.ctrl && name === 'a')) {
      this.cursorPos = 0;
      return;
    }
    if (name === 'end' || (key.ctrl && name === 'e')) {
      this.cursorPos = a.notes.length;
      return;
    }

    // Emacs-style word motion (macOS Option+arrows emit ESC+b/f)
    if (key.meta && name === 'b') {
      let p = this.cursorPos;
      while (p > 0 && a.notes[p - 1] === ' ') p--;
      while (p > 0 && a.notes[p - 1] !== ' ') p--;
      this.cursorPos = p;
      return;
    }
    if (key.meta && name === 'f') {
      let p = this.cursorPos;
      while (p < a.notes.length && a.notes[p] !== ' ') p++;
      while (p < a.notes.length && a.notes[p] === ' ') p++;
      this.cursorPos = p;
      return;
    }
    if (key.meta && name === 'd') {
      // Option+Delete: delete next word
      let p = this.cursorPos;
      while (p < a.notes.length && a.notes[p] === ' ') p++;
      while (p < a.notes.length && a.notes[p] !== ' ') p++;
      a.notes = a.notes.slice(0, this.cursorPos) + a.notes.slice(p);
      a.committed = false;
      return;
    }
    if (key.ctrl && name === 'w') {
      // Ctrl+W: delete previous word
      let p = this.cursorPos;
      while (p > 0 && a.notes[p - 1] === ' ') p--;
      while (p > 0 && a.notes[p - 1] !== ' ') p--;
      a.notes = a.notes.slice(0, p) + a.notes.slice(this.cursorPos);
      this.cursorPos = p;
      a.committed = false;
      return;
    }
    if (key.ctrl && name === 'u') {
      // Ctrl+U / Cmd+Backspace: delete to start of line
      a.notes = a.notes.slice(this.cursorPos);
      this.cursorPos = 0;
      a.committed = false;
      return;
    }
    if (key.ctrl && name === 'k') {
      // Ctrl+K: delete to end of line
      a.notes = a.notes.slice(0, this.cursorPos);
      a.committed = false;
      return;
    }

    // Printable character
    if (ch && ch.length === 1 && ch >= ' ') {
      a.notes = a.notes.slice(0, this.cursorPos) + ch + a.notes.slice(this.cursorPos);
      this.cursorPos++;
      a.committed = false;
    }
  }

  // ── Rendering (from Codex render.rs) ──

  render(): void {
    const { rows } = process.stdout;
    const { columns } = process.stdout;
    const lines: string[] = [];

    // Progress header (from Codex: "Progress header keeps the user oriented")
    if (this.questions.length > 1) {
      const idx = this.currentIdx + 1;
      const total = this.questions.length;
      lines.push(ansi.dim(`Question ${idx}/${total}`));
    }

    // Question text (cyan if unanswered, from Codex render)
    const q = this.q;
    if (q) {
      const answered = this.ans?.committed ?? false;
      const header = q.header ? `${ansi.bold(q.header)}  ` : '';
      const questionText = answered ? q.question : ansi.accent(q.question);
      lines.push('');
      lines.push(`${header}${questionText}`);
    }

    // Options (from Codex option_rows) — scrollable when list exceeds terminal height
    let inlineRow = -1;
    let inlineCol = -1;
    if (this.hasOptions && q?.options) {
      lines.push('');
      const a = this.ans;
      const allOptions = [...q.options];
      if (q.isOther) {
        allOptions.push({ label: OTHER_OPTION_LABEL, description: OTHER_OPTION_DESCRIPTION });
      }

      // Calculate how many options fit: each takes 2 lines, reserve ~8 for header/question/notes/footer
      const totalRows = rows ?? 24;
      const reservedLines = 8;
      const maxVisible = Math.max(2, Math.floor((totalRows - reservedLines) / 2));
      const needsScroll = allOptions.length > maxVisible;

      // Adjust scroll offset to keep selected option visible
      const sel = a?.selectedIdx ?? 0;
      if (sel < this.scrollOffset) this.scrollOffset = sel;
      if (sel >= this.scrollOffset + maxVisible) this.scrollOffset = sel - maxVisible + 1;
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, allOptions.length - maxVisible));

      const visibleStart = needsScroll ? this.scrollOffset : 0;
      const visibleEnd = needsScroll ? Math.min(visibleStart + maxVisible, allOptions.length) : allOptions.length;

      if (needsScroll && visibleStart > 0) {
        lines.push(ansi.dim(`    ↑ ${visibleStart} more`));
      }

      for (let i = visibleStart; i < visibleEnd; i++) {
        const opt = allOptions[i];
        const atCursor = a?.selectedIdx === i;
        const checked = q.multiSelect && a?.selectedSet.has(i);
        const prefix = atCursor ? ansi.boldAccent('›') : ' ';
        const checkbox = q.multiSelect ? (checked ? ansi.boldAccent('[x]') : ansi.dim('[ ]')) + ' ' : '';
        const number = q.multiSelect ? '' : `${i + 1}. `;
        const label = atCursor ? ansi.boldAccent(opt.label) : opt.label;
        const desc = ansi.dim(opt.description);

        let optionLine = `  ${prefix} ${checkbox}${number}${label}`;

        // Inline text field for typeIfSelected options
        if (opt.typeIfSelected) {
          const isEditing = atCursor && this.focus === 'notes';
          const notes = (atCursor ? a?.notes : '') ?? '';
          if (isEditing) {
            optionLine += ansi.dim(':') + ' ' + notes;
            inlineRow = lines.length + 1; // 1-indexed row (line will be pushed next)
            inlineCol = 2 + 1 + 1 + number.length + 1 + opt.label.length + 2 + this.cursorPos + 1;
          } else {
            optionLine += ansi.dim(': type here');
          }
        }

        lines.push(optionLine);
        lines.push(`       ${desc}`);
      }

      if (needsScroll && visibleEnd < allOptions.length) {
        lines.push(ansi.dim(`    ↓ ${allOptions.length - visibleEnd} more`));
      }

      // Submit button for multiSelect
      if (q.multiSelect) {
        lines.push('');
        const onButton = this.cursorOnSubmitButton;
        const count = a?.selectedSet.size ?? 0;
        const label = count > 0 ? `Submit (${count})` : 'Submit';
        const buttonLine = onButton ? `  ${ansi.boldAccent('›')} ${ansi.boldAccent(label)}` : `    ${ansi.dim(label)}`;
        lines.push(buttonLine);
      }
    }

    // Notes area (from Codex: notes always available, rendered via composer)
    let notesViewOffset = 0;
    if (this.notesUIVisible()) {
      lines.push('');
      const a = this.ans;
      const notes = a?.notes ?? '';
      const placeholder = this.notesPlaceholder();
      const focusedOnNotes = this.focus === 'notes';
      const prefix = focusedOnNotes ? '> ' : '  ';
      const maxWidth = (columns ?? 80) - prefix.length - 1;

      if (notes || focusedOnNotes) {
        const label = focusedOnNotes ? ansi.accent(prefix) : prefix;
        if (notes.length <= maxWidth) {
          lines.push(`${label}${notes || ansi.dim(placeholder)}`);
        } else {
          // Scroll window to keep cursor visible
          notesViewOffset = Math.max(0, this.cursorPos - maxWidth + 1);
          const visible = notes.slice(notesViewOffset, notesViewOffset + maxWidth);
          lines.push(`${label}${visible}`);
        }
      } else {
        lines.push(`  ${ansi.dim(placeholder)}`);
      }
    }

    // Footer hints
    lines.push('');
    const tips: string[] = [];
    if (this.isMultiSelect) {
      tips.push('enter/space to toggle');
      tips.push('esc to cancel');
    } else {
      if (this.hasOptions) {
        if (this.ans?.selectedIdx != null && !this.notesUIVisible() && !this.selectedOptionRequiresType()) {
          tips.push(ansi.boldAccent('tab to add notes'));
        }
        if (this.ans?.selectedIdx != null && this.notesUIVisible()) {
          tips.push('tab or esc to clear notes');
        }
      }
      const isLast = this.currentIdx + 1 >= this.questions.length;
      if (this.questions.length === 1) {
        tips.push(ansi.boldAccent('enter to submit'));
      } else if (isLast) {
        tips.push(ansi.boldAccent('enter to submit all'));
      } else {
        tips.push('enter to submit answer');
      }
      if (this.questions.length > 1 && this.hasOptions && this.focus === 'options') {
        tips.push('←/→ to navigate questions');
      }
      if (!(this.hasOptions && this.notesUIVisible())) {
        tips.push('esc to cancel');
      }
    }
    lines.push(ansi.dim(tips.join(' | ')));

    // Write to screen
    write(ansi.hideCursor);
    write(`${CSI}0;0H`); // move to top
    for (let i = 0; i < lines.length; i++) {
      write(`${CSI}${i + 1};1H${CSI}2K${lines[i]}`);
    }
    // Clear remaining lines
    for (let i = lines.length; i < (rows ?? 24); i++) {
      write(`${CSI}${i + 1};1H${CSI}2K`);
    }

    // Show cursor positioned in notes if focused there
    if (this.focus === 'notes' && inlineRow > 0) {
      // Inline typeIfSelected text field cursor
      write(ansi.showCursor);
      write(`${CSI}${inlineRow};${inlineCol}H`);
    } else if (this.focus === 'notes' && this.notesUIVisible()) {
      // Find the notes line more precisely
      let notesRow = lines.length - 2; // default near bottom
      for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, '');
        if (stripped.startsWith('> ') || (this.ans?.notes && stripped.includes(this.ans.notes))) {
          notesRow = i;
          break;
        }
      }
      const col = 3 + this.cursorPos - notesViewOffset; // prefix + cursor position adjusted for scroll
      write(ansi.showCursor);
      write(`${CSI}${notesRow + 1};${col}H`);
    } else {
      write(ansi.hideCursor);
    }
  }

  // ── Public API ──

  isDone(): boolean {
    return this.done;
  }

  getResponse(): UserInputResponse {
    return this.buildResponse();
  }
}

// ── Exported function (matches Codex's request_user_input tool interface) ──

export async function requestUserInput(
  questions: UserInputQuestion[],
): Promise<UserInputResponse> {
  if (questions.length === 0) {
    return new Map();
  }

  const overlay = new RequestUserInputOverlay(questions);

  // Enter raw mode for keypress handling (like Codex's crossterm raw mode)
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  readline.emitKeypressEvents(process.stdin);

  // Save screen state
  write(`${CSI}?1049h`); // switch to alternate screen buffer
  write(ansi.clearScreen);

  return new Promise<UserInputResponse>((resolve) => {
    overlay.render();

    const onKeypress = (_: string, key: readline.Key) => {
      if (!key) return;

      // Ctrl+C always exits
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve(new Map());
        return;
      }

      overlay.handleKey(key);

      if (overlay.isDone()) {
        cleanup();
        resolve(overlay.getResponse());
        return;
      }

      overlay.render();
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
      // Restore screen
      write(ansi.showCursor);
      write(`${CSI}?1049l`); // switch back from alternate screen buffer
    };

    process.stdin.on('keypress', onKeypress);
  });
}
