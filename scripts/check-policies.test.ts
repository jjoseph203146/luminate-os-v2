import { describe, expect, it } from "vitest";
import { findPolicyProblems } from "./check-policies";

describe("findPolicyProblems", () => {
  it("rejects the old project_services policy (no TO, USING true)", () => {
    const sql = `CREATE POLICY "Authenticated full access" ON project_services
      FOR ALL USING (true) WITH CHECK (true);`;
    const reasons = findPolicyProblems(sql).map((p) => p.reason);
    expect(reasons).toHaveLength(2);
  });

  it("accepts a role-scoped admin policy", () => {
    const sql = `CREATE POLICY "admin_full" ON public.clients
      FOR ALL TO authenticated
      USING (public.user_role() = 'admin')
      WITH CHECK (public.user_role() = 'admin');`;
    expect(findPolicyProblems(sql)).toEqual([]);
  });

  it("rejects USING (true) even with a TO clause", () => {
    const sql = `create policy p on t for select to authenticated using ( true );`;
    expect(findPolicyProblems(sql)).toHaveLength(1);
  });

  it("ignores policies inside comments", () => {
    const sql = `-- CREATE POLICY bad ON t USING (true);
      /* create policy bad2 on t using (true); */
      select 1;`;
    expect(findPolicyProblems(sql)).toEqual([]);
  });
});
