export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ migrateAndSeed }, { getDataSource }] = await Promise.all([
      import("./db/bootstrap"),
      import("./db/connection"),
    ]);
    await migrateAndSeed(await getDataSource());
  }
}
