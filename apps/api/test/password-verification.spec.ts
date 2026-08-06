import * as argon2 from "argon2";
import { verifyStoredPassword } from "../src/modules/auth/password-verification";

describe("verifyStoredPassword", () => {
  const password = "LegacyPassword1!";
  const pepper = "production-pepper";

  it("accepts a password already protected by the current pepper", async () => {
    const hash = await argon2.hash(password + pepper);

    await expect(
      verifyStoredPassword(hash, password, pepper, true),
    ).resolves.toEqual({ valid: true, needsPepperUpgrade: false });
  });

  it("upgrades an unpeppered legacy password only when migration is enabled", async () => {
    const hash = await argon2.hash(password);

    await expect(
      verifyStoredPassword(hash, password, pepper, true),
    ).resolves.toEqual({ valid: true, needsPepperUpgrade: true });
    await expect(
      verifyStoredPassword(hash, password, pepper, false),
    ).resolves.toEqual({ valid: false, needsPepperUpgrade: false });
  });

  it("rejects invalid and malformed hashes", async () => {
    const hash = await argon2.hash(password);

    await expect(
      verifyStoredPassword(hash, "wrong-password", pepper, true),
    ).resolves.toEqual({ valid: false, needsPepperUpgrade: false });
    await expect(
      verifyStoredPassword("not-an-argon-hash", password, pepper, true),
    ).resolves.toEqual({ valid: false, needsPepperUpgrade: false });
  });
});
