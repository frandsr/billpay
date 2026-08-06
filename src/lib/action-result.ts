/**
 * The result shape a Server Action hands back to the UI.
 *
 * Actions REFUSE by returning `ok: false` with a message the caller can toast,
 * rather than throwing: a forged or stale request is an expected outcome of an
 * open demo app, not an exception. A failure and a success therefore take the
 * same code path in the component.
 *
 * This lives in the functional core rather than beside the actions because a
 * `"use server"` module may export nothing but async functions, so the type
 * cannot be declared where it is produced.
 *
 * Two richer variants exist for the flows that need more than a message, and
 * both are supersets of this contract rather than competing ideas:
 *
 *  * `ActionResult<T>` in `@/components/recurring/types` — carries a typed
 *    payload on success and `fieldErrors` on failure, which the recurring form
 *    needs to put a message on the row that caused it.
 *  * `ActionResult` in `@/server/actions/bill-edit` — a discriminated union
 *    that narrows on `ok`, which the line-items editor relies on.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
}
