import type Database from "better-sqlite3";

// Keep quoted identifiers and literals intact. Comments and spacing around
// punctuation may differ after SQLite rewrites a table for ALTER TABLE.
const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|[\w$]+|->>|->|\|\||<=|>=|<>|!=|==|<<|>>|[^\s]/g;

export function dumpSchema(db: Database.Database): string {
  // The earliest app framework kept its migration history in _sqlx_migrations.
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE name NOT GLOB 'sqlite_*' AND name <> '_migrations'
      AND tbl_name NOT IN ('_migrations', '_sqlx_migrations') AND sql IS NOT NULL
    ORDER BY name, type
  `).all() as { type: string; name: string; sql: string }[];
  return rows.map(({ type, name, sql }) => {
    const words = (sql.match(tokens) ?? []).filter(word => !word.startsWith("--") && !word.startsWith("/*"));
    return JSON.stringify([type, name, words]);
  }).join("\n") + "\n";
}
