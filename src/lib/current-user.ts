"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { User } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Demo identity.
 *
 * There is no auth in this project — the reviewer switches between seeded users
 * with the top-bar user switcher, which writes the selected id to a cookie.
 * Everything that needs "who is acting" (approvals, activity, ownership) goes
 * through `getCurrentUser()`.
 *
 * NOTE: this file carries the "use server" directive, so every export must be
 * an async function. Constants live in `@/lib/current-user.shared`.
 */

const CURRENT_USER_COOKIE = "billpay_user_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The acting user. Falls back to the first seeded ADMIN (then to any user) so
 * a fresh browser with no cookie still works.
 *
 * Throws only when the database has no users at all, which means the seed did
 * not run — a loud failure is better than a silent empty UI here.
 */
export async function getCurrentUser(): Promise<User> {
  const cookieStore = await cookies();
  const userId = cookieStore.get(CURRENT_USER_COOKIE)?.value;

  if (userId) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (user) return user;
  }

  // The seed writes users in a fixed order, so "oldest" is deterministically
  // Maya Chen, the AP clerk — the identity that makes the demo make sense.
  const fallback = await db.user.findFirst({
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
  });

  if (!fallback) {
    throw new Error(
      "No users found. Run `pnpm db:seed` (or `docker compose up`) to seed the demo data.",
    );
  }

  return fallback;
}

/** Every seeded user, for the switcher dropdown. */
export async function listDemoUsers(): Promise<User[]> {
  return db.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
}

/**
 * Server action bound to the user switcher. Sets the cookie and revalidates the
 * whole app so server components re-render as the new identity.
 */
export async function setCurrentUser(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`Unknown user: ${userId}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  revalidatePath("/", "layout");
}
