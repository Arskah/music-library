import { timingSafeEqual } from "node:crypto";

export const CHALLENGE = 'Basic realm="Library search", charset="UTF-8"';

/** The `Authorization` header the shared login, `user:password`, sends, or
 * null when `BASIC_AUTH` is unset and the page is open. */
export function expected(): string | null {
  const login = process.env.BASIC_AUTH?.trim();
  return login ? `Basic ${Buffer.from(login).toString("base64")}` : null;
}

/** Compares in time that depends on the lengths alone, not on where the two
 * first differ. */
export function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
