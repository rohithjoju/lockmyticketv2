/**
 * Password hashing (SPEC §8): argon2id. Never bcrypt/MD5/SHA.
 *
 * Uses Bun's built-in argon2id (libargon2) rather than the `argon2` npm
 * package — same algorithm and output format ($argon2id$v=19$...), no native
 * build step. Hashes are interchangeable between the two.
 */

const ARGON2ID = { algorithm: 'argon2id' } as const;

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, ARGON2ID);
}

/**
 * Constant-time verify. Returns false on a malformed hash rather than
 * throwing, so a corrupt row can't 500 the login route.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}
