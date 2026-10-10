import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Accounts and roles. Passwords are stored only as salted scrypt hashes; a
// session is a random token the browser holds in an HttpOnly cookie and the
// database holds only the hash of. Node's own crypto, so no dependency.

export type Role = "guest" | "user" | "admin";

export interface User {
  id: string; // public: shown in every API response, proves nothing by itself
  name: string;
  role: Exclude<Role, "guest">;
}

// What each role may do. A guest is anyone without a valid session.
export const ACTIONS = [
  "post",
  "confirm",
  "correct",
  "stock",
  "comment",
  "like",
  "report",
  "notifications",
  "delete-own", // a post or comment of your own
  "delete-any",
  "moderate", // restore a reported comment, or keep it hidden
] as const;
export type Action = (typeof ACTIONS)[number];

const MEMBER: readonly Action[] = [
  "post", "confirm", "correct", "stock", "comment", "like", "report", "notifications", "delete-own",
];
const PERMISSIONS: Record<Role, readonly Action[]> = {
  guest: [],
  user: MEMBER,
  admin: [...MEMBER, "delete-any", "moderate"],
};

export const can = (role: Role, action: Action): boolean => PERMISSIONS[role].includes(action);

// --- passwords

const KEY_LENGTH = 64;
const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: (await derive(password, salt)).toString("hex") };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const key = await derive(password, Buffer.from(salt, "hex"));
  const want = Buffer.from(hash, "hex");
  return key.length === want.length && timingSafeEqual(key, want);
}

// --- sessions

export const SESSION_DAYS = 30;
export const newToken = (): string => randomBytes(32).toString("hex");
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newUserId = (): string => randomBytes(8).toString("hex");
