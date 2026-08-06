import { describe, expect, it } from "vitest";

import { USER_ROLES, type UserRole } from "@/lib/domain";
import {
  BILL_REOPEN_ROLES,
  PAYMENT_EXECUTION_ROLES,
  canExecutePayments,
  canReopenBill,
  describeRoles,
  refuseBillReopen,
  refusePaymentExecution,
} from "@/lib/permissions";

const CREATOR = "user-maya";
const SOMEONE_ELSE = "user-priya";

describe("payment execution", () => {
  it.each([["ADMIN"], ["APPROVER"]] as const)("allows %s", (role) => {
    expect(canExecutePayments(role)).toBe(true);
    expect(refusePaymentExecution(role)).toBeNull();
  });

  it("refuses a MEMBER — the clerk who raises a bill does not also pay it", () => {
    expect(canExecutePayments("MEMBER")).toBe(false);
    const refusal = refusePaymentExecution("MEMBER");
    expect(refusal?.reason).toBe("PAYMENT_REQUIRES_ELEVATED_ROLE");
  });

  it("names the roles that would be enough, so the message is actionable", () => {
    const refusal = refusePaymentExecution("MEMBER");
    expect(refusal?.message).toContain("Admin");
    expect(refusal?.message).toContain("Approver");
  });

  it("agrees with the role list it publishes", () => {
    for (const role of USER_ROLES) {
      expect(canExecutePayments(role)).toBe(
        PAYMENT_EXECUTION_ROLES.includes(role),
      );
    }
  });
});

describe("reopening a rejected bill", () => {
  const forRole = (role: UserRole, userId: string) => ({
    role,
    userId,
    billCreatedById: CREATOR,
  });

  it("allows the creator, whatever their role", () => {
    for (const role of USER_ROLES) {
      expect(canReopenBill(forRole(role, CREATOR))).toBe(true);
      expect(refuseBillReopen(forRole(role, CREATOR))).toBeNull();
    }
  });

  it("allows an ADMIN who did not raise the bill", () => {
    expect(canReopenBill(forRole("ADMIN", SOMEONE_ELSE))).toBe(true);
  });

  it("refuses an APPROVER who did not raise the bill", () => {
    // An approver may reject a bill; reopening it is the creator's move.
    expect(canReopenBill(forRole("APPROVER", SOMEONE_ELSE))).toBe(false);
    expect(refuseBillReopen(forRole("APPROVER", SOMEONE_ELSE))?.reason).toBe(
      "REOPEN_REQUIRES_CREATOR_OR_ADMIN",
    );
  });

  it("refuses a MEMBER who did not raise the bill", () => {
    expect(canReopenBill(forRole("MEMBER", SOMEONE_ELSE))).toBe(false);
  });

  it("agrees with the role list it publishes for non-creators", () => {
    for (const role of USER_ROLES) {
      expect(canReopenBill(forRole(role, SOMEONE_ELSE))).toBe(
        BILL_REOPEN_ROLES.includes(role),
      );
    }
  });
});

describe("describeRoles", () => {
  it("renders one role plainly", () => {
    expect(describeRoles(["ADMIN"])).toBe("Admin");
  });

  it("joins two with 'or'", () => {
    expect(describeRoles(["ADMIN", "APPROVER"])).toBe("Admin or Approver");
  });

  it("comma-separates three", () => {
    expect(describeRoles(["ADMIN", "APPROVER", "MEMBER"])).toBe(
      "Admin, Approver or Member",
    );
  });

  it("survives an empty list rather than rendering 'undefined'", () => {
    expect(describeRoles([])).toBe("");
  });
});
