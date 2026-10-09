// Spoken commands at the end of a sentence. Speech recognition may add
// punctuation around them.
const DONE_WORD = /[\s,.;:!?-]*\b(done|fertig)\b[\s.!?]*$/i;
const CANCEL_WORD = /[\s,.;:!?-]*\b(cancel|abbrechen|abbruch)\b[\s.!?]*$/i;

export function endsWithDone(text: string): boolean {
  return DONE_WORD.test(text);
}

export function endsWithCancel(text: string): boolean {
  return CANCEL_WORD.test(text);
}

// The words without a trailing command, ready to be turned into a receipt.
export function stripCommandWords(text: string): string {
  return text.replace(DONE_WORD, '').replace(CANCEL_WORD, '').trim();
}
