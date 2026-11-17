export type SyntaxKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "path"
  | "url"
  | "punctuation"
  | `bracket${1 | 2 | 3 | 4 | 5 | 6}`;

export type SyntaxSpan = { start: number; end: number; kind: SyntaxKind };

const KEYWORDS = new Set(
  `
  abstract alignas alignof and_eq asm assert async auto await base bitand bitor bool box
  break byte case catch chan char class compl concept const consteval constexpr constinit
  const_cast constructor continue crate co_await co_return co_yield debugger decimal def
  defer defined del delete descending didSet do double dynamic dynamic_cast elif else
  elseif enum ensure equals esac event except explicit export extends extern fallthrough
  false fi fileprivate final finally float fn for foreach friend from func function get
  global go goto group guard if implements implicit import in inline inout instanceof int
  interface internal into is join keyof lambda lazy let local lock long loop map match mod
  module move mut mutating namespace native never new next nil none nonlocal not not_eq
  null nullptr object on operator or or_eq out override package params partial pass print
  private protected protocol pub public raise range readonly record redo ref reinterpret_cast
  remove repeat required rescue retry rethrows return sealed select self set short sizeof
  static static_assert static_cast struct subscript super switch synchronized table template
  then this thread_local throw throws trait true try type typealias typeid typedef typename
  typeof union unknown unsafe unsigned until unset use using value var virtual void volatile
  wchar_t weak when where while willSet with xor xor_eq yield
  bitstruct comptime discard errdefer fault foreach_r mixin nextcase orelse par proc tvar
  unreachable within limit
  `.trim().split(/\s+/),
);

const WORD = /[A-Za-z_]\w*/y;
const NUMBER = /\d[\d_]*(?:\.[\d_]+)?/y;
const URL = /[A-Za-z][\w+.-]*:\/\/[^\s<>"']+/y;
const PATH = /\/[A-Za-z][\w\-.]*(?:\/[\w{}\-.]+)*\/?/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//y;
const HTML_COMMENT = /<!--[\s\S]*?-->/y;
const SHEBANG = /#![^\n]*/y;
const LINE_COMMENT = /\/\/[^\n]*/y;
const HASH_COMMENT = /#[ \t][^\n]*/y;
const LONE_HASH = /#(?=\n|$)/y;
const DASH_COMMENT = /--(?:[ \t][^\n]*|(?=\n|$))/y;
const STRINGS = [
  /"(?:[^"\\\n]|\\.)*"/y,
  /'(?:[^'\\\n]|\\.)*'/y,
  /`(?:[^`\\]|\\.)*`/y,
];

function isKeyword(word: string): boolean {
  return KEYWORDS.has(word) || (word === word.toUpperCase() && KEYWORDS.has(word.toLowerCase()));
}

function matchAt(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return match ? match[0] : null;
}

function push(spans: SyntaxSpan[], at: number, value: string, kind: SyntaxKind) {
  spans.push({ start: at, end: at + value.length, kind });
}

export function tokenize(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  let depth = 0;
  let at = 0;

  while (at < text.length) {
    const char = text[at]!;
    if (/\s/.test(char)) {
      at++;
      continue;
    }

    const url = matchAt(URL, text, at);
    if (url) {
      push(spans, at, url, "url");
      at += url.length;
      continue;
    }

    const comment =
      matchAt(BLOCK_COMMENT, text, at) ??
      matchAt(HTML_COMMENT, text, at) ??
      matchAt(SHEBANG, text, at) ??
      matchAt(LINE_COMMENT, text, at) ??
      matchAt(HASH_COMMENT, text, at) ??
      matchAt(LONE_HASH, text, at) ??
      matchAt(DASH_COMMENT, text, at);
    if (comment) {
      push(spans, at, comment, "comment");
      at += comment.length;
      continue;
    }

    const string = STRINGS.map((pattern) => matchAt(pattern, text, at)).find(Boolean);
    if (string) {
      push(spans, at, string, "string");
      at += string.length;
      continue;
    }

    const previous = text[at - 1] ?? " ";
    if (!/\w/.test(previous)) {
      const path = matchAt(PATH, text, at);
      if (path) {
        push(spans, at, path, "path");
        at += path.length;
        continue;
      }
    }

    const number = matchAt(NUMBER, text, at);
    if (number) {
      push(spans, at, number, "number");
      at += number.length;
      continue;
    }

    const word = matchAt(WORD, text, at);
    if (word) {
      if (isKeyword(word)) push(spans, at, word, "keyword");
      at += word.length;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      push(spans, at, char, `bracket${((depth % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6}`);
      depth++;
      at++;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      push(spans, at, char, `bracket${((depth % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6}`);
      at++;
      continue;
    }

    push(spans, at, char, "punctuation");
    at++;
  }

  return mergePunctuation(spans);
}

function mergePunctuation(spans: SyntaxSpan[]): SyntaxSpan[] {
  const merged: SyntaxSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && last.kind === "punctuation" && span.kind === "punctuation" && last.end === span.start) {
      last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}
