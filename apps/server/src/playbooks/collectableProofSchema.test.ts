import { describe, expect, it } from "vitest";
import { isCollectableSchema } from "../runtime/proof";
import { allPlaybooks } from "./selectPlaybook";

describe("Collectable Proof Schema invariant", () => {
  it("registers at least one playbook", () => {
    expect(allPlaybooks.length).toBeGreaterThan(0);
  });

  for (const playbook of allPlaybooks) {
    it(`only advertises Collectable Proof Schemas for playbook ${playbook.id}`, () => {
      const nonCollectable = playbook.proofSchemas.filter((proofSchema) => !isCollectableSchema(proofSchema));
      expect(nonCollectable.map((proofSchema) => proofSchema.id)).toEqual([]);
    });

    it(`every task template in playbook ${playbook.id} points at a registered proof schema`, () => {
      const registered = new Set(playbook.proofSchemas.map((proofSchema) => proofSchema.id));
      const orphans = playbook.taskTemplates.filter((template) => !registered.has(template.proofSchemaId));
      expect(orphans.map((template) => template.key)).toEqual([]);
    });
  }
});
