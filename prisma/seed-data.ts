/**
 * Deterministic demo dataset for Bill Pay.
 *
 * This module is pure data — no database access — so it can be shared by
 * `prisma/seed.ts` and `scripts/generate-invoices.ts` (which renders one
 * placeholder invoice PDF per bill from exactly the same numbers).
 *
 * Determinism: every id, name, amount and line item is hardcoded. The only
 * moving part is the DATE ANCHOR: due dates are expressed as `dueInDays`
 * relative to *today* (UTC midnight) so the AP Aging report keeps showing
 * populated buckets no matter when the reviewer runs the seed. Given a date,
 * the seed output is byte-identical on every run.
 */

import type {
  ActivityType,
  BillSource,
  BillStatus,
  GlAccountType,
  LineType,
  PaymentMethod,
  PaymentStatus,
  PaymentTerms,
  RecurringFrequency,
  UserRole,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  title: string;
  role: UserRole;
  initials: string;
  avatarColor: string;
}

/** Order matters: the first entry is the default identity when no cookie is set. */
export const USERS: SeedUser[] = [
  {
    id: "usr_maya",
    name: "Maya Chen",
    email: "maya.chen@northwind.example",
    title: "AP Clerk",
    role: "MEMBER",
    initials: "MC",
    avatarColor: "#2563eb",
  },
  {
    id: "usr_daniel",
    name: "Daniel Okafor",
    email: "daniel.okafor@northwind.example",
    title: "Controller",
    role: "APPROVER",
    initials: "DO",
    avatarColor: "#059669",
  },
  {
    id: "usr_priya",
    name: "Priya Raman",
    email: "priya.raman@northwind.example",
    title: "Chief Financial Officer",
    role: "APPROVER",
    initials: "PR",
    avatarColor: "#7c3aed",
  },
  {
    id: "usr_alex",
    name: "Alex Whitfield",
    email: "alex.whitfield@northwind.example",
    title: "Head of Operations",
    role: "APPROVER",
    initials: "AW",
    avatarColor: "#ea580c",
  },
  {
    id: "usr_sofia",
    name: "Sofia Delgado",
    email: "sofia.delgado@northwind.example",
    title: "Workplace Manager",
    role: "MEMBER",
    initials: "SD",
    avatarColor: "#db2777",
  },
  {
    id: "usr_tom",
    name: "Tom Bergstrom",
    email: "tom.bergstrom@northwind.example",
    title: "IT & Systems Admin",
    role: "ADMIN",
    initials: "TB",
    avatarColor: "#0891b2",
  },
];

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export interface SeedGlAccount {
  code: string;
  name: string;
  type: GlAccountType;
  active?: boolean;
}

export const GL_ACCOUNTS: SeedGlAccount[] = [
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "5000", name: "Cost of Revenue", type: "EXPENSE" },
  { code: "6000", name: "Payroll & Benefits", type: "EXPENSE" },
  { code: "6100", name: "Software & Subscriptions", type: "EXPENSE" },
  { code: "6110", name: "Cloud Infrastructure", type: "EXPENSE" },
  { code: "6200", name: "Rent & Facilities", type: "EXPENSE" },
  { code: "6210", name: "Utilities", type: "EXPENSE" },
  { code: "6220", name: "Office Supplies", type: "EXPENSE" },
  { code: "6300", name: "Marketing & Advertising", type: "EXPENSE" },
  { code: "6310", name: "Events & Conferences", type: "EXPENSE" },
  { code: "6400", name: "Professional Services", type: "EXPENSE" },
  { code: "6410", name: "Legal Fees", type: "EXPENSE" },
  { code: "6420", name: "Accounting & Audit", type: "EXPENSE" },
  { code: "6500", name: "Travel & Entertainment", type: "EXPENSE" },
  { code: "6600", name: "Insurance", type: "EXPENSE" },
  { code: "6700", name: "Equipment & Hardware", type: "EXPENSE" },
  { code: "6800", name: "Recruiting", type: "EXPENSE", active: false },
];

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * A seeded supplier.
 *
 * The remittance address and the bank details are OPTIONAL, because a vendor
 * that has not finished onboarding is a real state the product models: each
 * payment rail requires its own fields, and `missingVendorPaymentDetails`
 * refuses the rails whose fields are absent. One seeded vendor is deliberately
 * left incomplete so that rule is demonstrable rather than merely implemented.
 */
export interface SeedVendor {
  key: string;
  name: string;
  email: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  bankName?: string;
  accountLast4?: string;
  routingLast4?: string;
  defaultPaymentTerms: PaymentTerms;
  defaultGlCode: string;
  taxId?: string;
  is1099?: boolean;
  notes?: string;
}

export const VENDORS: SeedVendor[] = [
  {
    key: "aws",
    name: "Amazon Web Services",
    email: "ar@aws.example",
    addressLine1: "410 Terry Ave N",
    city: "Seattle",
    state: "WA",
    postalCode: "98109",
    bankName: "Wells Fargo",
    accountLast4: "4417",
    routingLast4: "0248",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6110",
    taxId: "91-1646860",
    notes: "Consolidated billing across all production accounts.",
  },
  {
    key: "wework",
    name: "WeWork",
    email: "billing@wework.example",
    addressLine1: "75 Rockefeller Plaza",
    addressLine2: "Floor 10",
    city: "New York",
    state: "NY",
    postalCode: "10019",
    bankName: "JPMorgan Chase",
    accountLast4: "8830",
    routingLast4: "1102",
    defaultPaymentTerms: "NET_15",
    defaultGlCode: "6200",
    taxId: "45-2884352",
    notes: "Monthly membership, 42 desks. Invoice arrives on the 1st.",
  },
  {
    key: "figma",
    name: "Figma",
    email: "billing@figma.example",
    addressLine1: "760 Market St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94102",
    bankName: "Silicon Valley Bank",
    accountLast4: "2291",
    routingLast4: "3310",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6100",
  },
  {
    key: "slack",
    name: "Slack Technologies",
    email: "ar@slack.example",
    addressLine1: "500 Howard St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    bankName: "Bank of America",
    accountLast4: "6614",
    routingLast4: "0512",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6100",
  },
  {
    key: "gusto",
    name: "Gusto",
    email: "invoices@gusto.example",
    addressLine1: "525 20th St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94107",
    bankName: "Silicon Valley Bank",
    accountLast4: "7729",
    routingLast4: "3310",
    defaultPaymentTerms: "NET_15",
    defaultGlCode: "6000",
    notes: "Payroll platform fees. Do not net against payroll funding.",
  },
  {
    key: "adobe",
    name: "Adobe",
    email: "ar@adobe.example",
    addressLine1: "345 Park Ave",
    city: "San Jose",
    state: "CA",
    postalCode: "95110",
    bankName: "Citibank",
    accountLast4: "9083",
    routingLast4: "7741",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6100",
  },
  {
    key: "deel",
    name: "Deel",
    email: "billing@deel.example",
    addressLine1: "425 1st St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    bankName: "JPMorgan Chase",
    accountLast4: "5502",
    routingLast4: "1102",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6000",
    notes: "EOR fees for the EMEA contractors.",
  },
  {
    key: "notion",
    name: "Notion Labs",
    email: "ar@notion.example",
    addressLine1: "2300 Harrison St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94110",
    bankName: "Silicon Valley Bank",
    accountLast4: "3140",
    routingLast4: "3310",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6100",
  },
  {
    key: "docusign",
    name: "DocuSign",
    email: "billing@docusign.example",
    addressLine1: "221 Main St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    bankName: "US Bank",
    accountLast4: "1177",
    routingLast4: "9903",
    defaultPaymentTerms: "NET_45",
    defaultGlCode: "6100",
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    email: "ar@cloudflare.example",
    addressLine1: "101 Townsend St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94107",
    bankName: "Bank of America",
    accountLast4: "8256",
    routingLast4: "0512",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6110",
  },
  {
    key: "datadog",
    name: "Datadog",
    email: "billing@datadoghq.example",
    addressLine1: "620 8th Ave",
    addressLine2: "Floor 45",
    city: "New York",
    state: "NY",
    postalCode: "10018",
    bankName: "JPMorgan Chase",
    accountLast4: "4408",
    routingLast4: "1102",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6110",
    notes: "Usage-based; expect month-over-month variance.",
  },
  {
    key: "brightline",
    name: "Brightline Legal LLP",
    email: "accounting@brightlinelegal.example",
    addressLine1: "1 Bryant Park",
    addressLine2: "Suite 3800",
    city: "New York",
    state: "NY",
    postalCode: "10036",
    bankName: "Citibank",
    accountLast4: "6720",
    routingLast4: "7741",
    defaultPaymentTerms: "NET_45",
    defaultGlCode: "6410",
    taxId: "13-4099122",
    notes: "Outside counsel. Matter number must appear on every invoice.",
  },
  {
    key: "sparkle",
    name: "Sparkle City Cleaning",
    email: "hello@sparklecity.example",
    addressLine1: "1180 Folsom St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94103",
    bankName: "Chase",
    accountLast4: "2013",
    routingLast4: "1102",
    defaultPaymentTerms: "NET_15",
    defaultGlCode: "6200",
    taxId: "84-3320145",
    is1099: true,
  },
  {
    key: "northgate",
    name: "Northgate Insurance Group",
    email: "ar@northgateins.example",
    addressLine1: "200 Clarendon St",
    city: "Boston",
    state: "MA",
    postalCode: "02116",
    bankName: "Santander",
    accountLast4: "7781",
    routingLast4: "4420",
    defaultPaymentTerms: "NET_60",
    defaultGlCode: "6600",
    taxId: "04-2778301",
    notes: "General liability + D&O. Annual policy billed quarterly.",
  },
  {
    key: "ironpeak",
    name: "Iron Peak Staffing",
    email: "billing@ironpeakstaffing.example",
    addressLine1: "800 W 6th St",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    bankName: "Frost Bank",
    accountLast4: "9145",
    routingLast4: "6602",
    defaultPaymentTerms: "NET_30",
    defaultGlCode: "6400",
    taxId: "74-3011882",
    is1099: true,
  },
  {
    // The one vendor that CANNOT be paid yet, on purpose.
    //
    // `missingVendorPaymentDetails` blocks a rail whose details are absent, and
    // with every seeded vendor fully onboarded that rule was correct, enforced
    // and permanently invisible. Bellweather has no bank details (so ACH and
    // wire are blocked) and no remittance address (so is a check), leaving only
    // the virtual card — which is exactly the conversation the rule exists to
    // start. Its APPROVED bill below is the reviewer's way in.
    key: "bellweather",
    name: "Bellweather Design Studio",
    email: "studio@bellweather.example",
    defaultPaymentTerms: "DUE_ON_RECEIPT",
    defaultGlCode: "6300",
    taxId: "88-2019447",
    is1099: true,
  },
];

// ---------------------------------------------------------------------------
// Approval policies
//
// Resolution rule (mirrored by src/lib/approval-policy.ts): among ACTIVE
// policies, evaluate by `priority` ASC and take the FIRST whose
// `minAmountCents` <= bill.totalCents. Zero steps means auto-approve.
// ---------------------------------------------------------------------------

export interface SeedApprovalPolicy {
  id: string;
  name: string;
  description: string;
  priority: number;
  minAmountDollars: number;
  /** Approver user ids in evaluation order. Empty = auto-approve. */
  approverIds: string[];
}

export const APPROVAL_POLICIES: SeedApprovalPolicy[] = [
  {
    id: "pol_executive",
    name: "Executive approval",
    description:
      "Bills of $10,000 or more need the Controller and then the CFO.",
    priority: 10,
    minAmountDollars: 10_000,
    approverIds: ["usr_daniel", "usr_priya"],
  },
  {
    id: "pol_controller",
    name: "Controller approval",
    description: "Bills of $1,000 or more need the Controller.",
    priority: 20,
    minAmountDollars: 1_000,
    approverIds: ["usr_daniel"],
  },
  {
    id: "pol_auto",
    name: "Auto-approve under $1,000",
    description: "Low-value bills skip the approval flow entirely.",
    priority: 30,
    minAmountDollars: 0,
    approverIds: [],
  },
];

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

/** [description, quantity, unitPriceDollars, glCode | null, department | null] */
export type SeedLine = [string, number, number, string | null, string | null];

export interface SeedBill {
  key: string;
  vendorKey: string;
  billNumber: string;
  status: BillStatus;
  terms: PaymentTerms;
  /** Days from today (UTC). Negative = already past due. */
  dueInDays: number;
  source?: BillSource;
  memo?: string;
  createdById?: string;
  lines: SeedLine[];
  lineType?: LineType;
  /**
   * Overrides the computed Σ(lines). Used only to build deliberately
   * unbalanced DRAFT bills that must surface as `Missing info`.
   */
  totalOverrideDollars?: number;
  /** Skip the invoice document, to exercise the empty preview state. */
  noInvoice?: boolean;
  /** How many approval steps are already APPROVED (AWAITING_APPROVAL only). */
  approvedSteps?: number;
  payment?: {
    status: PaymentStatus;
    method: PaymentMethod;
    /** Days from today. */
    scheduledInDays: number;
  };
  /** Why the bill was rejected / archived — used in the activity feed. */
  decisionNote?: string;
}

export const BILLS: SeedBill[] = [
  // -------------------------------------------------------------------------
  // DRAFT — 8 bills, 4 of them deliberately incomplete (`Missing info`)
  // -------------------------------------------------------------------------
  {
    key: "draft_figma",
    vendorKey: "figma",
    billNumber: "FIG-20416",
    status: "DRAFT",
    terms: "NET_30",
    dueInDays: 22,
    lines: [
      ["Figma Organization — 42 editor seats", 42, 45, "6100", "Engineering"],
    ],
    memo: "Renewal for the design + product org.",
  },
  {
    key: "draft_notion",
    vendorKey: "notion",
    billNumber: "NTN-77120",
    status: "DRAFT",
    terms: "NET_30",
    dueInDays: 18,
    source: "OCR",
    // No GL account -> Missing info.
    lines: [["Notion Business — annual, 120 seats", 1, 4800, null, null]],
    memo: "Scanned from the emailed PDF. Coding not confirmed yet.",
  },
  {
    key: "draft_sparkle",
    vendorKey: "sparkle",
    billNumber: "SCC-1042",
    status: "DRAFT",
    terms: "NET_15",
    dueInDays: 9,
    createdById: "usr_sofia",
    lines: [
      ["Nightly office cleaning — 22 visits", 22, 45, "6200", "Operations"],
      ["Deep clean — kitchen and lounge", 1, 260, "6200", "Operations"],
    ],
  },
  {
    key: "draft_ironpeak",
    vendorKey: "ironpeak",
    billNumber: "IPS-3391",
    status: "DRAFT",
    terms: "NET_30",
    dueInDays: -12,
    source: "OCR",
    // Lines sum to $6,240 but the scanned total says $6,890 -> Missing info.
    lines: [["Contract QA engineer — 80 hrs", 80, 78, "6400", "Engineering"]],
    totalOverrideDollars: 6890,
    memo: "OCR total does not match the extracted lines. Needs review.",
  },
  {
    key: "draft_bellweather",
    vendorKey: "bellweather",
    billNumber: "BWD-0288",
    status: "DRAFT",
    terms: "DUE_ON_RECEIPT",
    dueInDays: 3,
    source: "EMAIL",
    // No line items at all -> Missing info.
    lines: [],
    totalOverrideDollars: 3200,
    memo: "Forwarded from design@. Nothing coded yet.",
  },
  {
    key: "draft_adobe",
    vendorKey: "adobe",
    billNumber: "ADB-55901",
    status: "DRAFT",
    terms: "NET_30",
    dueInDays: 27,
    lines: [
      ["Creative Cloud — 18 licences", 18, 84.99, "6100", "Marketing"],
      ["Acrobat Pro — 12 licences", 12, 23.99, "6100", "Operations"],
    ],
  },
  {
    key: "draft_datadog",
    vendorKey: "datadog",
    billNumber: "DDG-88214",
    status: "DRAFT",
    terms: "NET_30",
    dueInDays: -38,
    source: "CSV",
    // Second line has no GL account -> Missing info.
    lines: [
      ["Infrastructure monitoring — 140 hosts", 140, 23, "6110", "Engineering"],
      ["Log management — 400 GB ingested", 400, 2.4, null, "Engineering"],
    ],
    memo: "Imported from the March usage export.",
  },
  {
    key: "draft_docusign",
    vendorKey: "docusign",
    billNumber: "DSG-40118",
    status: "DRAFT",
    terms: "NET_45",
    dueInDays: 40,
    noInvoice: true,
    lines: [["eSignature Business Pro — 25 seats", 25, 45.6, "6100", "Sales"]],
    memo: "Quote only — the PDF invoice has not arrived yet.",
  },

  // -------------------------------------------------------------------------
  // AWAITING_APPROVAL — 10 bills, mixed positions in their approval chain
  // -------------------------------------------------------------------------
  {
    key: "await_aws",
    vendorKey: "aws",
    billNumber: "AWS-2026-0148",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: 12,
    approvedSteps: 1,
    lines: [
      ["Amazon EC2 — production", 1, 8420.55, "6110", "Engineering"],
      ["Amazon RDS — Aurora cluster", 1, 3180.4, "6110", "Engineering"],
      ["Amazon S3 — object storage", 1, 1640.25, "6110", "Engineering"],
      ["Data transfer out", 1, 1042.8, "6110", "Engineering"],
    ],
  },
  {
    key: "await_wework",
    vendorKey: "wework",
    billNumber: "WW-2026-0311",
    status: "AWAITING_APPROVAL",
    terms: "NET_15",
    dueInDays: 5,
    approvedSteps: 0,
    createdById: "usr_sofia",
    lines: [
      ["Dedicated desks — 42 @ monthly rate", 42, 410, "6200", "Operations"],
      ["Private office 10B", 1, 1280, "6200", "Operations"],
    ],
  },
  {
    key: "await_gusto",
    vendorKey: "gusto",
    billNumber: "GST-91044",
    status: "AWAITING_APPROVAL",
    terms: "NET_15",
    dueInDays: -4,
    approvedSteps: 0,
    lines: [
      ["Payroll platform — 118 employees", 118, 39, "6000", "People"],
      ["Benefits administration", 1, 1638, "6000", "People"],
    ],
  },
  {
    key: "await_slack",
    vendorKey: "slack",
    billNumber: "SLK-60228",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: 20,
    approvedSteps: 0,
    lines: [["Slack Business+ — 132 seats", 132, 30, "6100", "G&A"]],
  },
  {
    key: "await_brightline",
    vendorKey: "brightline",
    billNumber: "BL-2026-0219",
    status: "AWAITING_APPROVAL",
    terms: "NET_45",
    dueInDays: -22,
    approvedSteps: 1,
    lines: [
      ["Matter 22-118 — partner hours", 26, 650, "6410", "Finance"],
      ["Matter 22-118 — associate hours", 34, 165, "6410", "Finance"],
      ["Filing fees and disbursements", 1, 240, "6410", "Finance"],
    ],
    memo: "Series B documentation review.",
  },
  {
    key: "await_deel",
    vendorKey: "deel",
    billNumber: "DEL-30877",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: 8,
    approvedSteps: 0,
    lines: [
      ["EOR — 11 contractors, EMEA", 11, 599, "6000", "People"],
      ["Contractor payments platform fee", 1, 2821, "6000", "People"],
    ],
  },
  {
    key: "await_cloudflare",
    vendorKey: "cloudflare",
    billNumber: "CF-71203",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: -47,
    approvedSteps: 0,
    lines: [
      ["Enterprise plan — monthly", 1, 1450, "6110", "Engineering"],
      ["Workers usage overage", 1, 400, "6110", "Engineering"],
    ],
  },
  {
    key: "await_northgate",
    vendorKey: "northgate",
    billNumber: "NIG-2026-Q1",
    status: "AWAITING_APPROVAL",
    terms: "NET_60",
    dueInDays: -68,
    approvedSteps: 1,
    lines: [
      ["General liability — Q1 premium", 1, 6400, "6600", "G&A"],
      ["D&O liability — Q1 premium", 1, 5500, "6600", "G&A"],
    ],
    memo: "Chased twice — the broker sent it to the wrong inbox.",
  },
  {
    key: "await_adobe",
    vendorKey: "adobe",
    billNumber: "ADB-56220",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: 15,
    approvedSteps: 0,
    lines: [
      ["Adobe Stock — team plan", 1, 1980, "6300", "Marketing"],
      ["Substance 3D — 4 seats", 4, 90, "6300", "Marketing"],
    ],
  },
  {
    key: "await_ironpeak",
    vendorKey: "ironpeak",
    billNumber: "IPS-3104",
    status: "AWAITING_APPROVAL",
    terms: "NET_30",
    dueInDays: -103,
    approvedSteps: 1,
    lines: [
      ["Contract platform engineer — 160 hrs", 160, 95, "6400", "Engineering"],
      ["Placement fee — senior SRE", 1, 1200, "6400", "Engineering"],
    ],
    memo: "Disputed placement fee. Held while Ops confirms the start date.",
  },

  // -------------------------------------------------------------------------
  // APPROVED — 7 bills, some already carrying a Payment
  // -------------------------------------------------------------------------
  {
    key: "appr_aws",
    vendorKey: "aws",
    billNumber: "AWS-2026-0121",
    status: "APPROVED",
    terms: "NET_30",
    dueInDays: 26,
    payment: { status: "SCHEDULED", method: "ACH", scheduledInDays: 23 },
    lines: [
      ["Amazon EC2 — production", 1, 7980.1, "6110", "Engineering"],
      ["Amazon RDS — Aurora cluster", 1, 2960.5, "6110", "Engineering"],
      ["CloudFront", 1, 1999.4, "6110", "Engineering"],
    ],
  },
  {
    // Approved and payable in principle, but the vendor has no bank details and
    // no remittance address — so scheduling refuses ACH, wire and check by
    // name, and only the virtual card is left. This is the one bill in the
    // dataset that exercises `missingVendorPaymentDetails` end to end.
    key: "appr_bellweather",
    vendorKey: "bellweather",
    billNumber: "BWD-0295",
    status: "APPROVED",
    terms: "DUE_ON_RECEIPT",
    dueInDays: 5,
    lines: [
      ["Website redesign — phase 2", 1, 3400, "6300", "Marketing"],
      ["Illustration set — 6 pieces", 6, 275, "6300", "Marketing"],
    ],
  },
  {
    key: "appr_figma",
    vendorKey: "figma",
    billNumber: "FIG-20188",
    status: "APPROVED",
    terms: "NET_30",
    dueInDays: 9,
    payment: { status: "SCHEDULED", method: "ACH", scheduledInDays: 7 },
    lines: [
      ["Figma Organization — 42 editor seats", 42, 45, "6100", "Engineering"],
      ["FigJam — 7 seats", 7, 45, "6100", "Engineering"],
    ],
  },
  {
    key: "appr_notion",
    vendorKey: "notion",
    billNumber: "NTN-76004",
    status: "APPROVED",
    terms: "NET_30",
    dueInDays: -9,
    lines: [["Notion Business — annual, 120 seats", 1, 4800, "6100", "G&A"]],
    memo: "Approved but not scheduled — waiting on the March cash forecast.",
  },
  {
    key: "appr_datadog",
    vendorKey: "datadog",
    billNumber: "DDG-87550",
    status: "APPROVED",
    terms: "NET_30",
    dueInDays: -33,
    payment: { status: "FAILED", method: "ACH", scheduledInDays: -30 },
    lines: [
      ["Infrastructure monitoring — 140 hosts", 140, 23, "6110", "Engineering"],
      ["APM — 60 hosts", 60, 31, "6110", "Engineering"],
      ["Log management — 900 GB ingested", 900, 2.4, "6110", "Engineering"],
    ],
    memo: "ACH returned R03 — vendor bank details need updating.",
  },
  {
    key: "appr_wework",
    vendorKey: "wework",
    billNumber: "WW-2026-0244",
    status: "APPROVED",
    terms: "NET_15",
    dueInDays: -55,
    createdById: "usr_sofia",
    lines: [
      ["Dedicated desks — 42 @ monthly rate", 42, 410, "6200", "Operations"],
      ["Private office 10B", 1, 1280, "6200", "Operations"],
    ],
    memo: "Held pending the credit note for the January outage.",
  },
  {
    key: "appr_docusign",
    vendorKey: "docusign",
    billNumber: "DSG-39002",
    status: "APPROVED",
    terms: "NET_45",
    dueInDays: -77,
    payment: { status: "INITIATED", method: "CHECK", scheduledInDays: -6 },
    lines: [["eSignature Business Pro — 25 seats", 25, 45.6, "6100", "Sales"]],
  },
  {
    key: "appr_sparkle",
    vendorKey: "sparkle",
    billNumber: "SCC-0964",
    status: "APPROVED",
    terms: "NET_15",
    dueInDays: -118,
    createdById: "usr_sofia",
    lines: [
      ["Nightly office cleaning — 20 visits", 20, 45, "6200", "Operations"],
      ["Window cleaning — quarterly", 1, 80, "6200", "Operations"],
    ],
    memo: "Fell through the cracks during the office move.",
  },

  // -------------------------------------------------------------------------
  // REJECTED — 3 bills
  // -------------------------------------------------------------------------
  {
    key: "rej_bellweather",
    vendorKey: "bellweather",
    billNumber: "BWD-0261",
    status: "REJECTED",
    terms: "DUE_ON_RECEIPT",
    dueInDays: -6,
    decisionNote: "Scope does not match the signed SOW. Please re-issue.",
    lines: [
      ["Brand refresh — discovery phase", 1, 4800, "6300", "Marketing"],
      ["Motion design — 3 assets", 3, 1000, "6300", "Marketing"],
    ],
  },
  {
    key: "rej_ironpeak",
    vendorKey: "ironpeak",
    billNumber: "IPS-3212",
    status: "REJECTED",
    terms: "NET_30",
    dueInDays: -41,
    decisionNote: "Hours billed exceed the approved contractor cap.",
    lines: [
      ["Contract data engineer — 120 hrs", 120, 102.5, "6400", "Engineering"],
    ],
  },
  {
    key: "rej_brightline",
    vendorKey: "brightline",
    billNumber: "BL-2026-0240",
    status: "REJECTED",
    terms: "NET_45",
    dueInDays: 11,
    decisionNote: "Missing the matter number required by our engagement letter.",
    lines: [
      ["Advisory hours — unspecified matter", 18, 250, "6410", "Finance"],
    ],
  },

  // -------------------------------------------------------------------------
  // PAID — 14 bills with completed Payments
  // -------------------------------------------------------------------------
  {
    key: "paid_aws_1",
    vendorKey: "aws",
    billNumber: "AWS-2026-0094",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -34,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -37 },
    lines: [
      ["Amazon EC2 — production", 1, 7420.3, "6110", "Engineering"],
      ["Amazon RDS — Aurora cluster", 1, 2880.7, "6110", "Engineering"],
      ["Amazon S3 — object storage", 1, 1480, "6110", "Engineering"],
    ],
  },
  {
    key: "paid_aws_2",
    vendorKey: "aws",
    billNumber: "AWS-2025-0061",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -64,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -66 },
    lines: [
      ["Amazon EC2 — production", 1, 6980.15, "6110", "Engineering"],
      ["Amazon RDS — Aurora cluster", 1, 2740.85, "6110", "Engineering"],
      ["Data transfer out", 1, 501, "6110", "Engineering"],
    ],
  },
  {
    key: "paid_wework_1",
    vendorKey: "wework",
    billNumber: "WW-2026-0182",
    status: "PAID",
    terms: "NET_15",
    dueInDays: -30,
    createdById: "usr_sofia",
    payment: { status: "PAID", method: "ACH", scheduledInDays: -32 },
    lines: [
      ["Dedicated desks — 42 @ monthly rate", 42, 410, "6200", "Operations"],
      ["Private office 10B", 1, 1280, "6200", "Operations"],
    ],
  },
  {
    key: "paid_wework_2",
    vendorKey: "wework",
    billNumber: "WW-2025-0120",
    status: "PAID",
    terms: "NET_15",
    dueInDays: -60,
    createdById: "usr_sofia",
    payment: { status: "PAID", method: "ACH", scheduledInDays: -63 },
    lines: [
      ["Dedicated desks — 40 @ monthly rate", 40, 410, "6200", "Operations"],
      ["Private office 10B", 1, 1280, "6200", "Operations"],
    ],
  },
  {
    key: "paid_figma",
    vendorKey: "figma",
    billNumber: "FIG-19844",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -45,
    payment: { status: "PAID", method: "CARD", scheduledInDays: -47 },
    lines: [["Figma Organization — 41 editor seats", 41, 45, "6100", "Engineering"]],
  },
  {
    key: "paid_slack",
    vendorKey: "slack",
    billNumber: "SLK-59710",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -50,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -52 },
    lines: [["Slack Business+ — 124 seats", 124, 30, "6100", "G&A"]],
  },
  {
    key: "paid_gusto",
    vendorKey: "gusto",
    billNumber: "GST-90211",
    status: "PAID",
    terms: "NET_15",
    dueInDays: -35,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -36 },
    lines: [
      ["Payroll platform — 116 employees", 116, 39, "6000", "People"],
      ["Benefits administration", 1, 1560, "6000", "People"],
    ],
  },
  {
    key: "paid_adobe",
    vendorKey: "adobe",
    billNumber: "ADB-54882",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -55,
    payment: { status: "PAID", method: "CARD", scheduledInDays: -58 },
    lines: [
      ["Creative Cloud — 18 licences", 18, 84.99, "6100", "Marketing"],
      ["Acrobat Pro — 10 licences", 10, 23.99, "6100", "Operations"],
    ],
  },
  {
    key: "paid_deel",
    vendorKey: "deel",
    billNumber: "DEL-30140",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -70,
    payment: { status: "PAID", method: "WIRE", scheduledInDays: -72 },
    lines: [
      ["EOR — 11 contractors, EMEA", 11, 599, "6000", "People"],
      ["Contractor payments platform fee", 1, 2341, "6000", "People"],
    ],
  },
  {
    key: "paid_notion",
    vendorKey: "notion",
    billNumber: "NTN-74551",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -80,
    payment: { status: "PAID", method: "CARD", scheduledInDays: -83 },
    lines: [["Notion Business — annual, 110 seats", 1, 4500, "6100", "G&A"]],
  },
  {
    key: "paid_cloudflare",
    vendorKey: "cloudflare",
    billNumber: "CF-70455",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -25,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -27 },
    lines: [
      ["Enterprise plan — monthly", 1, 1450, "6110", "Engineering"],
      ["Workers usage overage", 1, 270, "6110", "Engineering"],
    ],
  },
  {
    key: "paid_datadog",
    vendorKey: "datadog",
    billNumber: "DDG-86118",
    status: "PAID",
    terms: "NET_30",
    dueInDays: -90,
    payment: { status: "PAID", method: "ACH", scheduledInDays: -92 },
    lines: [
      ["Infrastructure monitoring — 132 hosts", 132, 23, "6110", "Engineering"],
      ["APM — 55 hosts", 55, 31, "6110", "Engineering"],
      ["Log management — 750 GB ingested", 750, 2.4, "6110", "Engineering"],
    ],
  },
  {
    key: "paid_brightline",
    vendorKey: "brightline",
    billNumber: "BL-2025-0188",
    status: "PAID",
    terms: "NET_45",
    dueInDays: -95,
    payment: { status: "PAID", method: "WIRE", scheduledInDays: -98 },
    lines: [
      ["Matter 21-902 — partner hours", 20, 650, "6410", "Finance"],
      ["Matter 21-902 — associate hours", 32, 165, "6410", "Finance"],
      ["Filing fees and disbursements", 1, 320, "6410", "Finance"],
    ],
  },
  {
    key: "paid_northgate",
    vendorKey: "northgate",
    billNumber: "NIG-2025-Q4",
    status: "PAID",
    terms: "NET_60",
    dueInDays: -120,
    payment: { status: "PAID", method: "CHECK", scheduledInDays: -124 },
    lines: [
      ["General liability — Q4 premium", 1, 6400, "6600", "G&A"],
      ["D&O liability — Q4 premium", 1, 5500, "6600", "G&A"],
    ],
  },

  // -------------------------------------------------------------------------
  // ARCHIVED — 3 bills
  // -------------------------------------------------------------------------
  {
    key: "arch_docusign",
    vendorKey: "docusign",
    billNumber: "DSG-39002-DUP",
    status: "ARCHIVED",
    terms: "NET_45",
    dueInDays: -15,
    decisionNote: "Duplicate of DSG-39002.",
    lines: [["eSignature Business Pro — 25 seats", 25, 45.6, "6100", "Sales"]],
  },
  {
    key: "arch_sparkle",
    vendorKey: "sparkle",
    billNumber: "SCC-1011",
    status: "ARCHIVED",
    terms: "NET_15",
    dueInDays: -20,
    createdById: "usr_sofia",
    decisionNote: "Vendor re-issued with the correct site address.",
    lines: [["Nightly office cleaning — 21 visits", 21, 45, "6200", "Operations"]],
  },
  {
    key: "arch_ironpeak",
    vendorKey: "ironpeak",
    billNumber: "IPS-3350",
    status: "ARCHIVED",
    terms: "NET_30",
    dueInDays: 6,
    decisionNote: "Engagement cancelled before the contractor started.",
    lines: [["Contract designer — retainer", 1, 3400, "6400", "Marketing"]],
  },
];

// ---------------------------------------------------------------------------
// Splits and allocation templates
//
// GLOSSARY: a SPLIT distributes ONE line across several GL accounts/dimensions
// and Σ(splits) equals the line amount; an ALLOCATION TEMPLATE is a saved,
// named split pattern. Shares are BASIS POINTS (1% = 100), and the cents are
// distributed by `distributeByBasisPoints` so they always add back up.
// ---------------------------------------------------------------------------

/** One share of a split or of a template. */
export interface SeedAllocationRow {
  glCode: string;
  department: string | null;
  percentBasisPoints: number;
}

export interface SeedAllocationTemplate {
  id: string;
  name: string;
  description: string;
  active?: boolean;
  rows: SeedAllocationRow[];
}

export const ALLOCATION_TEMPLATES: SeedAllocationTemplate[] = [
  {
    id: "alt_office_rent",
    name: "Office rent 50/30/20",
    description:
      "Headcount-based split of workplace costs across Engineering, Sales and Operations.",
    rows: [
      { glCode: "6200", department: "Engineering", percentBasisPoints: 5000 },
      { glCode: "6200", department: "Sales", percentBasisPoints: 3000 },
      { glCode: "6200", department: "Operations", percentBasisPoints: 2000 },
    ],
  },
  {
    id: "alt_cloud_by_team",
    name: "Cloud spend by team",
    description:
      "Infrastructure cost allocation agreed with FinOps: 70% Engineering, 30% Data.",
    rows: [
      { glCode: "6110", department: "Engineering", percentBasisPoints: 7000 },
      { glCode: "6110", department: "Data", percentBasisPoints: 3000 },
    ],
  },
];

/** Splits applied to a specific line of a specific bill. */
export interface SeedLineItemSplits {
  /** `SeedBill.key`. */
  billKey: string;
  /** `sortOrder` of the line within that bill (its index in `lines`). */
  lineSortOrder: number;
  rows: SeedAllocationRow[];
}

/**
 * Six seeded splits, so the coding UI has something to render before anyone
 * touches it. The AWS rows deliberately do not divide evenly — the largest
 * remainder distribution is visible in the demo data, not just in a test.
 */
export const LINE_ITEM_SPLITS: SeedLineItemSplits[] = [
  // Rent, split 50/30/20 by headcount — twice, on two months of the same lease,
  // which is exactly the case the allocation template exists to serve.
  {
    billKey: "await_wework",
    lineSortOrder: 0,
    rows: ALLOCATION_TEMPLATES[0].rows,
  },
  {
    billKey: "appr_wework",
    lineSortOrder: 0,
    rows: ALLOCATION_TEMPLATES[0].rows,
  },
  // Cloud spend across two teams. $8,420.55 at 70/30 does not divide cleanly.
  {
    billKey: "await_aws",
    lineSortOrder: 0,
    rows: ALLOCATION_TEMPLATES[1].rows,
  },
  {
    billKey: "appr_aws",
    lineSortOrder: 0,
    rows: [
      { glCode: "6110", department: "Engineering", percentBasisPoints: 6500 },
      { glCode: "6110", department: "Data", percentBasisPoints: 3500 },
    ],
  },
  // Insurance premium spread over the departments it covers.
  {
    billKey: "await_northgate",
    lineSortOrder: 0,
    rows: [
      { glCode: "6600", department: "G&A", percentBasisPoints: 5000 },
      { glCode: "6600", department: "Engineering", percentBasisPoints: 3000 },
      { glCode: "6600", department: "Operations", percentBasisPoints: 2000 },
    ],
  },
  // Payroll platform, allocated by seats per department.
  {
    billKey: "await_gusto",
    lineSortOrder: 0,
    rows: [
      { glCode: "6000", department: "People", percentBasisPoints: 4000 },
      { glCode: "6000", department: "Engineering", percentBasisPoints: 3500 },
      { glCode: "6000", department: "Sales", percentBasisPoints: 2500 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Recurring bills — generators, not bills
// ---------------------------------------------------------------------------

export interface SeedRecurringBill {
  id: string;
  vendorKey: string;
  name: string;
  frequency: RecurringFrequency;
  /** Days from today (UTC). Zero or negative = already due to generate. */
  nextRunInDays: number;
  /** Preferred day of month, clamped to the month length. */
  dayOfMonth?: number;
  terms: PaymentTerms;
  memo?: string;
  /** A paused template owes nothing until it is switched back on. */
  active?: boolean;
  createdById?: string;
  /** Days from today the template last produced a bill. */
  lastGeneratedInDays?: number;
  lines: SeedLine[];
}

/**
 * Four templates. Two are already due (`nextRunInDays` ≤ 0) so "generate now"
 * produces a visible DRAFT on the reviewer's first click, one is upcoming, and
 * one is paused to exercise the inactive state.
 */
export const RECURRING_BILLS: SeedRecurringBill[] = [
  {
    id: "rec_wework_rent",
    vendorKey: "wework",
    name: "WeWork — monthly membership",
    frequency: "MONTHLY",
    nextRunInDays: -2,
    dayOfMonth: 1,
    terms: "NET_15",
    memo: "Membership invoice arrives on the 1st. Coding matches last month.",
    createdById: "usr_sofia",
    lastGeneratedInDays: -32,
    lines: [
      ["Dedicated desks — 42 @ monthly rate", 42, 410, "6200", "Operations"],
      ["Private office 10B", 1, 1280, "6200", "Operations"],
    ],
  },
  {
    id: "rec_northgate_insurance",
    vendorKey: "northgate",
    name: "Northgate — quarterly insurance premium",
    frequency: "QUARTERLY",
    nextRunInDays: 0,
    terms: "NET_60",
    memo: "Annual policy billed quarterly: general liability + D&O.",
    lastGeneratedInDays: -91,
    lines: [
      ["General liability — quarterly premium", 1, 6400, "6600", "G&A"],
      ["D&O liability — quarterly premium", 1, 5500, "6600", "G&A"],
    ],
  },
  {
    id: "rec_figma_seats",
    vendorKey: "figma",
    name: "Figma — monthly seats",
    frequency: "MONTHLY",
    nextRunInDays: 6,
    dayOfMonth: 12,
    terms: "NET_30",
    lastGeneratedInDays: -25,
    lines: [
      ["Figma Organization — 42 editor seats", 42, 45, "6100", "Engineering"],
      ["FigJam — 7 seats", 7, 45, "6100", "Engineering"],
    ],
  },
  {
    id: "rec_sparkle_cleaning",
    vendorKey: "sparkle",
    name: "Sparkle City — nightly office cleaning",
    frequency: "MONTHLY",
    nextRunInDays: 11,
    dayOfMonth: 5,
    terms: "NET_15",
    active: false,
    memo: "Paused while the office is being refitted. Resume in March.",
    createdById: "usr_sofia",
    lastGeneratedInDays: -36,
    lines: [
      ["Nightly office cleaning — 22 visits", 22, 45, "6200", "Operations"],
    ],
  },
];

// ---------------------------------------------------------------------------
// OCR extractions — an auditable RUN against a bill's invoice document
// ---------------------------------------------------------------------------

export interface SeedOcrExtraction {
  /** `SeedBill.key`. */
  billKey: string;
  provider: string;
  /** Overall confidence in basis points (0–10000). */
  confidenceBasisPoints: number;
  /** Per-field confidence, same units. */
  fieldConfidence: Record<string, number>;
  /** What a reviewer needs to look at, written by the extractor. */
  warnings: string[];
  /** Days from today the run happened. */
  extractedInDays: number;
}

/**
 * One run, attached to the OCR-mismatch draft (IPS-3391) whose scanned total
 * does not agree with its extracted lines. That draft is already the seed's
 * `Missing info` example; giving it a stored extraction means the OCR review UI
 * has a real disagreement to render before anyone uploads a file.
 */
export const OCR_EXTRACTIONS: SeedOcrExtraction[] = [
  {
    billKey: "draft_ironpeak",
    provider: "demo-ocr",
    confidenceBasisPoints: 7120,
    fieldConfidence: {
      vendorName: 9820,
      billNumber: 9910,
      issueDate: 9405,
      dueDate: 8830,
      paymentTerms: 8800,
      totalCents: 7120,
      lineItems: 6650,
    },
    warnings: [
      "Extracted line items sum to less than the extracted total — a line may be missing from the scan.",
      "Payment terms were inferred from the due date, not read from the document.",
    ],
    extractedInDays: -41,
  },
];

// ---------------------------------------------------------------------------
// Activity copy
// ---------------------------------------------------------------------------

export const ACTIVITY_MESSAGES: Partial<Record<ActivityType, string>> = {
  CREATED: "created this bill",
  SUBMITTED: "submitted this bill for approval",
  APPROVED: "approved this bill",
  REJECTED: "rejected this bill",
  PAYMENT_SCHEDULED: "scheduled the payment",
  PAID: "marked the payment as completed",
  ARCHIVED: "archived this bill",
};
