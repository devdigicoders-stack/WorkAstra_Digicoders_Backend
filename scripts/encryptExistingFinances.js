import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import Payment from "../models/PaymentSchema.js";
import Project from "../models/ProjectSchema.js";
import { encryptField } from "../utills/cryptoHelper.js";

const migrate = async () => {
    try {
        const uri = process.env.NODE_ENV === "development" ? process.env.MONGO_URI_DEV : (process.env.MONGO_URI_PROD || process.env.MONGO_URI_DEV);
        if (!uri) throw new Error("Mongo URI not found in .env");

        await mongoose.connect(uri);
        console.log("Connected to MongoDB for Payments & Project Finances encryption...");

        // 1. Encrypt Payments
        const payments = await Payment.find({});
        console.log(`Found ${payments.length} payment record(s) in database.`);
        let paymentsUpdated = 0;
        for (const p of payments) {
            const isAmountEncrypted = typeof p.amount === "string" && p.amount.startsWith("enc:");
            const isTxnEncrypted = typeof p.transactionId === "string" && p.transactionId.startsWith("enc:");

            if (!isAmountEncrypted || !isTxnEncrypted) {
                p.amount = encryptField(Number(p.amount) || 0);
                p.transactionId = encryptField(p.transactionId);
                await p.save();
                paymentsUpdated++;
                console.log(`🔒 Encrypted Payment ID: ${p._id}`);
            } else {
                console.log(`ℹ️ Already encrypted Payment ID: ${p._id}`);
            }
        }

        // 2. Encrypt Projects
        const projects = await Project.find({});
        console.log(`Found ${projects.length} project record(s) in database.`);
        let projectsUpdated = 0;
        for (const proj of projects) {
            const isPriceEncrypted = typeof proj.price === "string" && proj.price.startsWith("enc:");
            const isReceivedEncrypted = typeof proj.receivedAmount === "string" && proj.receivedAmount.startsWith("enc:");

            if (!isPriceEncrypted || !isReceivedEncrypted) {
                proj.price = encryptField(Number(proj.price) || 0);
                proj.receivedAmount = encryptField(Number(proj.receivedAmount) || 0);
                await proj.save();
                projectsUpdated++;
                console.log(`🔒 Encrypted Project Finances for "${proj.name}" (ID: ${proj._id})`);
            } else {
                console.log(`ℹ️ Already encrypted Project ID: ${proj._id}`);
            }
        }

        console.log(`\n✅ Migration Complete:`);
        console.log(`- ${paymentsUpdated} / ${payments.length} Payments encrypted`);
        console.log(`- ${projectsUpdated} / ${projects.length} Projects encrypted`);

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error("Migration error:", err.message);
        process.exit(1);
    }
};

migrate();
