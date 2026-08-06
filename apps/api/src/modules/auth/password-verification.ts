import * as argon2 from "argon2";

export interface PasswordVerificationResult {
  valid: boolean;
  needsPepperUpgrade: boolean;
}

async function matches(hash: string, candidate: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, candidate);
  } catch {
    return false;
  }
}

export async function verifyStoredPassword(
  hash: string,
  password: string,
  pepper: string,
  allowLegacyUnpepperedPassword: boolean,
): Promise<PasswordVerificationResult> {
  if (await matches(hash, password + pepper)) {
    return { valid: true, needsPepperUpgrade: false };
  }
  if (
    !pepper ||
    !allowLegacyUnpepperedPassword ||
    !(await matches(hash, password))
  ) {
    return { valid: false, needsPepperUpgrade: false };
  }
  return { valid: true, needsPepperUpgrade: true };
}
