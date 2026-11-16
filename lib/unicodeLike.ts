/**
 * LIKE as MySQL, MariaDB and SQL Server compare text under their default
 * collations: letter case is ignored for every alphabet, not only A to Z.
 * SQLite's own LIKE folds ASCII letters only, so 'École' LIKE 'é%' is false
 * there and true in those databases.
 *
 * The runtime installs this for the requests that need it and puts SQLite's
 * own LIKE back for the others (see SqlRuntime), so a schema's indexes and
 * generated columns are always built with the built-in, deterministic function.
 *
 * Accents are still compared exactly ('ecole' does not match 'é%'); MySQL's
 * default collation would also ignore them. That is listed as an open gap.
 */

type SqlValue = string | number | Uint8Array | null;

/** `%`, `_`, or one folded character to match exactly. */
const ANY = 0;
const ONE = 1;
type Token = typeof ANY | typeof ONE | string;

/** Lower-case one character, keeping it one character (a few letters lower-case to two). */
function fold(character: string): string {
  const lower = character.toLowerCase();
  return [...lower].length === 1 ? lower : character;
}

const patternCache = new Map<string, Token[]>();
const PATTERN_CACHE_SIZE = 200;

function parsePattern(pattern: string, escape: string | null): Token[] {
  // The escape is one character or absent, so the prefix cannot run into the pattern.
  const key = `${escape === null ? 'n' : `e${escape}`}:${pattern}`;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const tokens: Token[] = [];
  const characters = [...pattern];
  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];
    if (escape !== null && character === escape && i + 1 < characters.length) {
      tokens.push(fold(characters[++i]));
    } else if (character === '%') {
      // Consecutive % match the same thing as one.
      if (tokens[tokens.length - 1] !== ANY) tokens.push(ANY);
    } else if (character === '_') {
      tokens.push(ONE);
    } else {
      tokens.push(fold(character));
    }
  }
  if (patternCache.size >= PATTERN_CACHE_SIZE) patternCache.clear();
  patternCache.set(key, tokens);
  return tokens;
}

/** Wildcard match over folded characters, without recursion: on a mismatch, retry from the last % one character further on. */
function matches(tokens: Token[], characters: string[]): boolean {
  let token = 0;
  let character = 0;
  let lastAny = -1;
  let resume = 0;
  while (character < characters.length) {
    const current = tokens[token];
    if (current === ANY) {
      lastAny = token++;
      resume = character;
    } else if (current !== undefined && (current === ONE || current === characters[character])) {
      token++;
      character++;
    } else if (lastAny !== -1) {
      token = lastAny + 1;
      character = ++resume;
    } else {
      return false;
    }
  }
  while (tokens[token] === ANY) token++;
  return token === tokens.length;
}

function asText(value: SqlValue): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return String(value);
}

/** `value LIKE pattern [ESCAPE escape]`, ignoring letter case in every alphabet. NULL in, NULL out. */
export function unicodeLike(pattern: SqlValue, value: SqlValue, escape?: SqlValue): boolean | null {
  if (pattern === null || value === null) return null;
  let escapeCharacter: string | null = null;
  if (escape !== undefined) {
    if (escape === null) return null;
    const text = asText(escape);
    // The same refusal SQLite's own LIKE gives.
    if ([...text].length !== 1) throw new Error('ESCAPE expression must be a single character');
    escapeCharacter = text;
  }
  return matches(parsePattern(asText(pattern), escapeCharacter), [...asText(value)].map(fold));
}

interface FunctionHost {
  create_function(name: string, fn: (...args: never[]) => unknown): unknown;
}

/**
 * Replace the connection's LIKE with the Unicode one. `x LIKE y` calls
 * like(y, x) and `x LIKE y ESCAPE z` calls like(y, x, z): two argument counts
 * of one SQL function. sql.js keeps one JavaScript entry per name string while
 * SQLite matches names without regard to case, so the second count is
 * registered under a differently-cased spelling of the same name to keep both.
 */
export function installUnicodeLike(db: FunctionHost): void {
  const guarded = (run: () => boolean | null): boolean | null => {
    try {
      return run();
    } catch (error) {
      // sql.js passes a thrown string to SQLite's error-result API.
      throw error instanceof Error ? error.message : error;
    }
  };
  // sql.js registers SQLite's argument count from each function's declared parameters.
  const two = (pattern: SqlValue, value: SqlValue) => guarded(() => unicodeLike(pattern, value));
  const three = (pattern: SqlValue, value: SqlValue, escape: SqlValue) => guarded(() => unicodeLike(pattern, value, escape));
  db.create_function('like', two as (...args: never[]) => unknown);
  db.create_function('LIKE', three as (...args: never[]) => unknown);
}
