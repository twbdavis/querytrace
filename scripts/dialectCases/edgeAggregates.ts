import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const def: SchemaDef = {
  id: 'custom', name: 'Ordered aggregate edge cases', description: 'Ordering deliberately differs from insertion order.',
  starterQuery: 'SELECT * FROM ordered_entry;',
  ddl: `
CREATE TABLE ordered_group (grp TEXT PRIMARY KEY);
CREATE TABLE ordered_entry (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL REFERENCES ordered_group(grp),
  value TEXT,
  sort_key INTEGER
);
INSERT INTO ordered_group VALUES ('g1'), ('g2'), ('g3'), ('g4');
INSERT INTO ordered_entry VALUES
  (1, 'g1', 'beta', 2), (2, 'g1', 'alpha', 3),
  (3, 'g1', 'beta', 1), (4, 'g1', 'gamma', NULL),
  (5, 'g1', NULL, 4), (6, 'g2', 'x,y', 2),
  (7, 'g2', 'z', 1), (8, 'g2', 'a'';b', 3),
  (9, 'g3', NULL, 1);
`,
};

const grouped = [['g1', 'alpha/beta/beta/gamma'], ['g2', "a';b/x,y/z"], ['g3', null]];

export const PROBES = [{
  label: 'edge ordered aggregate semantics', def,
  cases: [
    {
      sql: "SELECT GROUP_CONCAT(value, '|' ORDER BY id DESC) AS names FROM ordered_entry;",
      rows: [["a';b|z|x,y|gamma|beta|alpha|beta"]], columns: ['names'],
      note: 'ORDER BY changes aggregate input order, rather than only sorting result rows',
    },
    { sql: "SELECT grp, GROUP_CONCAT(value, '/' ORDER BY sort_key DESC, id ASC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: grouped, ordered: true },
    { sql: "SELECT GROUP_CONCAT(value ORDER BY sort_key) AS names FROM ordered_entry WHERE grp = 'g1';", rows: [['gamma,beta,beta,alpha']] },
    { sql: 'SELECT grp, GROUP_CONCAT(DISTINCT value ORDER BY value DESC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;', rows: [['g1', 'gamma,beta,alpha'], ['g2', "z,x,y,a';b"], ['g3', null]], ordered: true },
    { sql: "SELECT grp, GROUP_CONCAT(value ORDER BY sort_key DESC, id ASC SEPARATOR '/') AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: grouped, ordered: true },
    { sql: "SELECT grp, STRING_AGG(value, '/' ORDER BY sort_key DESC, id ASC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: grouped, ordered: true },
    { sql: "SELECT grp, STRING_AGG(value, '/') WITHIN GROUP (ORDER BY sort_key DESC, id ASC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: grouped, ordered: true },
    { sql: "SELECT grp, GROUP_CONCAT(value, '/' ORDER BY sort_key DESC) AS names FROM ordered_entry GROUP BY grp HAVING GROUP_CONCAT(value, '/' ORDER BY sort_key DESC) LIKE 'alpha%' ORDER BY grp;", rows: [['g1', 'alpha/beta/beta/gamma']] },
    { sql: "WITH names AS (SELECT grp, GROUP_CONCAT(value, '/' ORDER BY sort_key DESC) AS names FROM ordered_entry GROUP BY grp) SELECT grp, names FROM names WHERE grp = 'g2';", rows: [['g2', "a';b/x,y/z"]] },
    { sql: "SELECT names FROM (SELECT grp, GROUP_CONCAT(value, '/' ORDER BY sort_key DESC) AS names FROM ordered_entry GROUP BY grp) t WHERE grp = 'g1';", rows: [['alpha/beta/beta/gamma']] },
    { sql: "SELECT grp, COALESCE(GROUP_CONCAT(SUBSTR(value, 1, 1), ' / ' ORDER BY LOWER(value), id DESC), '(empty)') AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: [['g1', 'a / b / b / g'], ['g2', 'a / x / z'], ['g3', '(empty)']], ordered: true },
    { sql: "SELECT 'GROUP_CONCAT(value ORDER BY sort_key)' AS literal, GROUP_CONCAT(value, 'ORDER BY;,' ORDER /* preserve comment */ BY sort_key DESC) AS names FROM ordered_entry WHERE grp = 'g1';", rows: [['GROUP_CONCAT(value ORDER BY sort_key)', 'alphaORDER BY;,betaORDER BY;,betaORDER BY;,gamma']] },
    { sql: "SELECT GROUP_CONCAT(value, '/' ORDER BY sort_key DESC) AS names FROM ordered_entry WHERE grp = 'missing';", rows: [[null]] },
    { sql: "SELECT grp, GROUP_CONCAT(value, '/' ORDER BY sort_key DESC NULLS FIRST, id ASC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: [['g1', 'gamma/alpha/beta/beta'], ['g2', "a';b/x,y/z"], ['g3', null]], ordered: true },
    { sql: "SELECT grp, GROUP_CONCAT(value ORDER BY LENGTH(value), value DESC) AS names FROM ordered_entry GROUP BY grp ORDER BY grp;", rows: [['g1', 'beta,beta,gamma,alpha'], ['g2', "z,x,y,a';b"], ['g3', null]], ordered: true },
    { sql: "SELECT g.grp, (SELECT GROUP_CONCAT(e.value, '/' ORDER BY e.sort_key DESC) FROM ordered_entry e WHERE e.grp = g.grp) AS names FROM ordered_group g ORDER BY g.grp;", rows: [...grouped, ['g4', null]], ordered: true },
    { sql: "SELECT STRING_AGG(DISTINCT value, '/' ORDER BY value) FROM ordered_entry;", reject: /distinct|separator/i, note: 'Do not corrupt embedded commas while emulating DISTINCT with a custom separator' },
  ] as Case[],
}];
