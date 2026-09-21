import bcrypt from "bcryptjs";
import Company from "../models/CompanySchema.js";

export const ensureCompanyPins = async () => {
    try {
        const DEFAULT_PIN = "706876";
        let hashedPin = null;

        // Find companies where securityPin is missing or null
        const companiesWithoutPin = await Company.find({
            $or: [
                { securityPin: { $exists: false } },
                { securityPin: null }
            ]
        });

        if (companiesWithoutPin.length > 0) {
            console.log(`[Startup Check] Found ${companiesWithoutPin.length} companies without a Security PIN. Assigning default PIN...`);
            hashedPin = await bcrypt.hash(DEFAULT_PIN, 10);

            for (const company of companiesWithoutPin) {
                company.securityPin = hashedPin;
                await company.save();
                console.log(`[Startup Check] Set default PIN for company: ${company.name}`);
            }
        }
    } catch (error) {
        console.error("[Startup Check] Error setting default company PINs:", error);
    }
};
