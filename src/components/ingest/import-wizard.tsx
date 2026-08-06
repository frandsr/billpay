import { getActiveGlAccounts, getActiveVendors } from "@/server/reference-data";

import { ImportWizardSteps } from "./import-wizard-steps";

/**
 * CSV import — data boundary.
 *
 * Reads its own reference data so the page that renders it stays a plain shell
 * and takes no props. The vendor and GL lists are shown beside the uploader
 * because "unknown vendor" and "unknown GL code" are the two errors an import
 * actually hits, and knowing the accepted values up front prevents both.
 */
export async function ImportWizard() {
  const [vendors, glAccounts] = await Promise.all([
    getActiveVendors(),
    getActiveGlAccounts(),
  ]);

  return (
    <ImportWizardSteps
      vendorNames={vendors.map((vendor) => vendor.name)}
      glAccounts={glAccounts.map((account) => ({
        code: account.code,
        name: account.name,
      }))}
    />
  );
}
