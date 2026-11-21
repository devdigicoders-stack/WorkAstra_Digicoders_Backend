import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import SalaryStructure from "../models/SalaryStructureSchema.js";
import { encryptSalaryStructure } from "../utills/cryptoHelper.js";

const migrate = async () => {
    try {
        const uri = process.env.NODE_ENV === "development" ? process.env.MONGO_URI_DEV : process.env.MONGO_URI_PROD;
        if (!uri) throw new Error("Mongo URI not found in .env");

        await mongoose.connect(uri);
        console.log("Connected to MongoDB for SalaryStructure encryption...");

        const structures = await SalaryStructure.find({});
        console.log(`Found ${structures.length} salary structure(s) in database.`);

        let updated = 0;
        for (const s of structures) {
            // Check if already encrypted
            const isCtcEncrypted = typeof s.ctc === "string" && s.ctc.startsWith("enc:");
            const isBasicEncrypted = typeof s.basic === "string" && s.basic.startsWith("enc:");

            if (!isCtcEncrypted || !isBasicEncrypted) {
                encryptSalaryStructure(s);
                await s.save();
                updated++;
                console.log(`🔒 Encrypted SalaryStructure for userId: ${s.userId} (ID: ${s._id})`);
            } else {
                console.log(`ℹ️ Already encrypted: ID ${s._id}`);
            }
        }

        console.log(`\n✅ Migration Complete: ${updated} out of ${structures.length} salary structures encrypted with AES-256-GCM!`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error("Migration error:", err.message);
        process.exit(1);
    }
};

migrate();
