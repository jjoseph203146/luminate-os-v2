// Blocks database security policies that are open to everyone.
//
// Rejects any CREATE POLICY that:
//   - has no TO clause (it then applies to PUBLIC, including the anonymous key), or
//   - uses USING (true) / WITH CHECK (true).
// This is the mistake that exposed project_services in the old app (S1).
// Usage: node scripts/check-policies.ts <migrations-dir>

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PolicyProblem {
  file: string;
  policy: string;
  reason: string;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function findPolicyProblems(sql: string, file = "<sql>"): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const statements = stripComments(sql).split(";");
  for (const raw of statements) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    const match = /^create policy\s+("[^"]+"|\S+)/i.exec(stmt);
    if (!match) continue;
    const policy = match[1] ?? "?";
    if (!/\sto\s/i.test(stmt)) {
      problems.push({ file, policy, reason: "no TO clause (applies to PUBLIC, including anon)" });
    }
    if (/\busing\s*\(\s*true\s*\)/i.test(stmt) || /\bwith check\s*\(\s*true\s*\)/i.test(stmt)) {
      problems.push({ file, policy, reason: "USING (true) or WITH CHECK (true)" });
    }
  }
  return problems;
}

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .flatMap((path) => (statSync(path).isDirectory() ? sqlFiles(path) : path.endsWith(".sql") ? [path] : []));
}

function main(): void {
  const dir = process.argv[2] ?? "supabase/migrations";
  const problems = sqlFiles(dir).flatMap((f) => findPolicyProblems(readFileSync(f, "utf8"), f));
  for (const p of problems) console.error(`${p.file}: policy ${p.policy}: ${p.reason}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} unsafe policy definition(s) found.`);
    process.exit(1);
  }
  console.log("Policy check passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
