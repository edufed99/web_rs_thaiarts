import type { DataSource } from "typeorm";

import { ApplicationUserEntity, MemberProfileEntity } from "../entities/Members";

// Precomputed bcrypt hash for "admin1234" to avoid runtime external dependencies in migration runner.
const DEFAULT_ADMIN_PASSWORD_HASH = "$2b$10$jigdR5LoEViR6.EUIW9GyuCKdf8ErabH87TomXUTRtbZK7.nClIAO";

export async function seedAdminUser(dataSource: DataSource): Promise<void> {
  const userRepo = dataSource.getRepository(ApplicationUserEntity);
  const profileRepo = dataSource.getRepository(MemberProfileEntity);

  const existing = await userRepo.findOneBy({ username: "admin" });
  if (!existing) {
    const adminUser = userRepo.create({
      username: "admin",
      email: "admin@thaiarts.local",
      passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
      authProvider: "password",
      emailVerified: true,
      displayName: "ผู้ดูแลระบบ (Admin)",
      isAdmin: true,
    });
    const savedUser = await userRepo.save(adminUser);

    const profile = profileRepo.create({
      userId: Number(savedUser.id),
      displayName: "ผู้ดูแลระบบ (Admin)",
      role: "super_admin",
      userGroup: "super_admin",
    });
    await profileRepo.save(profile);
  }
}
