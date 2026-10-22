import { maskSql, replaceOutsideLiterals, rewriteCalls, splitTopLevel, stripComments, topLevelMatches } from './sqlText';

/** Parser-only marker; SQLite must always receive its restored aggregate. */
export const ORDERED_GROUP_CONCAT_MARKER = 'QT_ORDERED_GROUP_CONCAT';

interface OrderingTerm {
  expression: string;
  direction: string;
}

/** A trailing SQL comment must not swallow the next generated comma/keyword. */
function fragment(text: string): string {
  const trimmed = text.trim();
  return stripComments(trimmed).split('\n').at(-1) !== trimmed.split('\n').at(-1) ? `${trimmed}\n` : trimmed;
}

function orderingTerm(text: string): OrderingTerm | null {
  const masked = maskSql(text);
  const suffix = topLevelMatches(masked, /\b(?:(?:ASC|DESC)(?:\s+NULLS\s+(?:FIRST|LAST))?|NULLS\s+(?:FIRST|LAST))\s*$/gi).at(-1);
  if (!suffix) return masked.trim() ? { expression: fragment(text), direction: 'ASC' } : null;
  const direction = suffix[0].match(/\b(?:ASC|DESC)\b/i)?.[0].toUpperCase() ?? 'ASC';
  const nulls = suffix[0].match(/\bNULLS\s+(FIRST|LAST)\b/i)?.[1].toUpperCase();
  const suffixAt = suffix.index ?? 0;
  // Preserve any comments around the removed ordering keywords. The scanner
  // replaces only syntax outside quoted values and identifiers.
  const comments = replaceOutsideLiterals(text.slice(suffixAt), /\b(?:ASC|DESC|NULLS|FIRST|LAST)\b/gi, '');
  const expression = fragment(text.slice(0, suffixAt) + comments);
  if (!maskSql(expression).trim()) return null;
  return { expression, direction: `${direction}${nulls ? ` NULLS ${nulls}` : ''}` };
}

/**
 * node-sql-parser's SQLite grammar cannot parse aggregate-local ORDER BY.
 * Encode it as ordinary function arguments for AST analysis/serialization;
 * the original, native SQLite syntax remains the executable representation.
 */
export function prepareOrderedAggregates(sql: string): string {
  return rewriteCalls(sql, ['GROUP_CONCAT'], (call) => {
    const orders = topLevelMatches(maskSql(call.inner), /\bORDER\s+BY\b/gi);
    if (orders.length !== 1) return null;
    const order = orders[0];
    const orderAt = order.index ?? 0;
    const args = splitTopLevel(call.inner.slice(0, orderAt));
    if (args.length < 1 || args.length > 2) return null;
    const distinct = maskSql(args[0]).match(/^(\s*)DISTINCT\b/i);
    // SQLite requires precisely one argument for DISTINCT aggregates.
    if (distinct && args.length !== 1) return null;
    const expression = fragment(distinct
      ? args[0].slice(0, distinct[1].length) + args[0].slice(distinct[0].length)
      : args[0]);
    if (!maskSql(expression).trim()) return null;
    const terms = splitTopLevel(call.inner.slice(orderAt + order[0].length)).map(orderingTerm);
    if (terms.length === 0 || terms.some((term) => !term)) return null;
    // Comments between ORDER and BY belong to the first expression after the
    // keywords have been removed, keeping comment/literal text intact.
    const orderComments = replaceOutsideLiterals(call.inner.slice(orderAt, orderAt + order[0].length), /\b(?:ORDER|BY)\b/gi, '').trim();
    if (orderComments) terms[0]!.expression = `${orderComments} ${terms[0]!.expression}`;
    const encodedOrder = terms.flatMap((term) => [term!.expression, `'${term!.direction}'`]);
    return `${ORDERED_GROUP_CONCAT_MARKER}(${[distinct ? '1' : '0', expression, fragment(args[1] ?? "','"), ...encodedOrder].join(', ')})`;
  });
}

/** Restore every parser marker before executing an AST-derived SQL fragment. */
export function restoreOrderedAggregates(sql: string): string {
  return rewriteCalls(sql, [ORDERED_GROUP_CONCAT_MARKER], (call) => {
    if (call.args.length < 5 || (call.args.length - 3) % 2 !== 0) return null;
    const flag = maskSql(call.args[0]).trim();
    if (flag !== '0' && flag !== '1') return null;
    const ordering: string[] = [];
    for (let index = 3; index < call.args.length; index += 2) {
      const direction = call.args[index + 1].match(/^'(ASC|DESC)(?:\s+NULLS\s+(FIRST|LAST))?'$/i);
      if (!direction) return null;
      ordering.push(`${fragment(call.args[index])} ${direction[1].toUpperCase()}${direction[2] ? ` NULLS ${direction[2].toUpperCase()}` : ''}`);
    }
    const args = flag === '1' ? `DISTINCT ${fragment(call.args[1])}` : `${fragment(call.args[1])}, ${fragment(call.args[2])}`;
    return `GROUP_CONCAT(${args} ORDER BY ${ordering.join(', ')})`;
  });
}
