import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet: Argon2id, 19 MiB memory, 2 iterations, 1 degree of parallelism.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password) {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Verifying against a real hash when the account does not exist keeps the response time of
// "unknown email" close to "wrong password", so timing does not reveal which accounts exist.
let dummyHash;
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
  return false;
}
