/**
 * Compile-time bridge between the pure domain enums in `@/lib/domain` and the
 * enums Prisma generates from `prisma/schema.prisma`.
 *
 * `src/lib/` may not import Prisma (functional core), so the core declares its
 * own string-literal unions. That buys testability but opens the door to drift:
 * add `PARTIALLY_PAID` to the schema, forget the core, and the two disagree
 * silently.
 *
 * The assertions below close that door. They are types, not code — nothing is
 * emitted and nothing runs — but `pnpm typecheck` fails the moment either side
 * gains or loses a member. This file is the ONLY place the two definitions are
 * allowed to meet.
 */

import type {
  ApprovalStepStatus as PrismaApprovalStepStatus,
  BillStatus as PrismaBillStatus,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  PaymentTerms as PrismaPaymentTerms,
} from "@prisma/client";

import type {
  ApprovalStepStatus,
  BillStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTerms,
} from "@/lib/domain";

/**
 * Exact type equality. The deferred conditional makes TypeScript compare the
 * two types structurally rather than by assignability, so a union that gained
 * or lost a member is reported instead of silently widening.
 */
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Resolves only when the assertion holds; otherwise `false` fails `extends true`. */
type Expect<T extends true> = T;

type _BillStatusParity = Expect<IsExact<BillStatus, PrismaBillStatus>>;
type _PaymentStatusParity = Expect<IsExact<PaymentStatus, PrismaPaymentStatus>>;
type _PaymentMethodParity = Expect<IsExact<PaymentMethod, PrismaPaymentMethod>>;
type _PaymentTermsParity = Expect<IsExact<PaymentTerms, PrismaPaymentTerms>>;
type _ApprovalStepStatusParity = Expect<
  IsExact<ApprovalStepStatus, PrismaApprovalStepStatus>
>;

export {};
