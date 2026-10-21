import mongoose from "mongoose";

const MONGODB_URI = "mongodb+srv://ecomdoctorbd_db_user:otlwVJVo1JqBk6GC@cluster0.iolrd90.mongodb.net/shopify_app";

async function main() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(MONGODB_URI, {
    bufferCommands: true,
    serverSelectionTimeoutMS: 15000,
  });
  console.log("Connected to MongoDB!");

  const systemConfigSchema = new mongoose.Schema(
    {
      key: { type: String, required: true, unique: true, default: "global" },
      supportEmail: { type: String, default: "ecomdoctorbd@gmail.com", trim: true },
      whatsappHelpline: { type: String, default: "01346851322", trim: true },
      whatsappNumber: { type: String, default: "+8801346851322", trim: true },
      tutorialLink: { type: String, default: "https://www.youtube.com/@ecomdoctorbd", trim: true },
    },
    { timestamps: true, collection: "SystemConfig" }
  );

  const SystemConfig = mongoose.models.SystemConfig || mongoose.model("SystemConfig", systemConfigSchema);

  const result = await SystemConfig.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        key: "global",
        supportEmail: "ecomdoctorbd@gmail.com",
        whatsappHelpline: "01346851322",
        whatsappNumber: "+8801346851322",
        tutorialLink: "https://www.youtube.com/@ecomdoctorbd",
        updatedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  console.log("Successfully injected SystemConfig record into MongoDB:");
  console.log(JSON.stringify(result, null, 2));

  // Verification read
  const verify = await SystemConfig.findOne({ key: "global" }).lean();
  console.log("Verification read from MongoDB:");
  console.log(JSON.stringify(verify, null, 2));

  await mongoose.disconnect();
  console.log("Disconnected cleanly.");
}

main().catch((err) => {
  console.error("Error seeding SystemConfig:", err);
  process.exit(1);
});
