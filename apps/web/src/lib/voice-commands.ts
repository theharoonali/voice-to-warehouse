// The worker ends a recording by saying one of these words last. Speech
// recognition may add punctuation around it.
const DONE_WORD = /[\s,.;:!?-]*\b(done|fertig)\b[\s.!?]*$/i;

export function endsWithDone(text: string): boolean {
  return DONE_WORD.test(text);
}

export function stripDoneWord(text: string): string {
  return text.replace(DONE_WORD, '').trim();
}
