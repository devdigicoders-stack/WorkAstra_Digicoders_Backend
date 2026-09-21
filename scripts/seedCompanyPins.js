import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Company from "../models/CompanySchema.js";
import EnvData from "../config/EnvData.js";
import connectDb from "../config/db.js";

const seedCompanyPins = async () => {
    try {
        await connectDb();
        console.log("Connected to Database.");

        const DEFAULT_PIN = "706876";
        const hashedPin = await bcrypt.hash(DEFAULT_PIN, 10);

        const companies = await Company.find({});
        console.log(`Found ${companies.length} companies to update.`);

        for (const company of companies) {
            company.securityPin = hashedPin;
            await company.save();
            console.log(`Updated security PIN for company: ${company.name}`);
        }

        console.log("Successfully seeded security PINs for all companies!");
        process.exit(0);
    } catch (error) {
        console.error("Error seeding company PINs:", error);
        process.exit(1);
    }
};

seedCompanyPins();
