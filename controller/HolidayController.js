import Holiday from "../models/HolidaySchema.js";
import User from "../models/UserSchema.js";
import { createNotification } from "../utills/notificationHelper.js";
import axios from "axios";

// Comprehensive Master Dataset for Indian National & Cultural Holidays
const INDIAN_HOLIDAYS_MASTER = {
    "2024": [
        { name: "New Year's Day", date: "2024-01-01", type: "optional", description: "First day of the year" },
        { name: "Makar Sankranti / Pongal", date: "2024-01-14", type: "restricted", description: "Harvest festival" },
        { name: "Republic Day", date: "2024-01-26", type: "national", description: "National Gazetted Holiday" },
        { name: "Maha Shivratri", date: "2024-03-08", type: "national", description: "Hindu festival celebrating Lord Shiva" },
        { name: "Holi", date: "2024-03-25", type: "national", description: "Festival of colours" },
        { name: "Good Friday", date: "2024-03-29", type: "national", description: "Christian holiday" },
        { name: "Eid-ul-Fitr", date: "2024-04-11", type: "national", description: "Islamic festival ending Ramadan" },
        { name: "Ambedkar Jayanti", date: "2024-04-14", type: "national", description: "Dr. B.R. Ambedkar's Birthday" },
        { name: "Ram Navami", date: "2024-04-17", type: "restricted", description: "Lord Rama's Birthday" },
        { name: "Mahavir Jayanti", date: "2024-04-21", type: "national", description: "Jain festival" },
        { name: "Buddha Purnima", date: "2024-05-23", type: "national", description: "Gautam Buddha's Birthday" },
        { name: "Bakrid / Eid-ul-Adha", date: "2024-06-17", type: "national", description: "Feast of the Sacrifice" },
        { name: "Muharram", date: "2024-07-17", type: "national", description: "First month of Islamic calendar" },
        { name: "Independence Day", date: "2024-08-15", type: "national", description: "India Independence Day" },
        { name: "Raksha Bandhan", date: "2024-08-19", type: "restricted", description: "Sibling festival" },
        { name: "Janmashtami", date: "2024-08-26", type: "national", description: "Lord Krishna's Birthday" },
        { name: "Milad-un-Nabi", date: "2024-09-16", type: "national", description: "Prophet Muhammad's Birthday" },
        { name: "Mahatma Gandhi Jayanti", date: "2024-10-02", type: "national", description: "Father of the Nation Birthday" },
        { name: "Dussehra (Vijayadashami)", date: "2024-10-12", type: "national", description: "Victory of good over evil" },
        { name: "Diwali (Deepavali)", date: "2024-10-31", type: "national", description: "Festival of lights" },
        { name: "Govardhan Puja", date: "2024-11-02", type: "restricted", description: "Govardhan Puja / Annakut" },
        { name: "Bhai Dooj", date: "2024-11-03", type: "restricted", description: "Bhai Dooj festival" },
        { name: "Chhath Puja", date: "2024-11-07", type: "restricted", description: "Sun God festival" },
        { name: "Guru Nanak Jayanti", date: "2024-11-15", type: "national", description: "Guru Nanak's Birthday" },
        { name: "Christmas", date: "2024-12-25", type: "national", description: "Christmas Day" }
    ],
    "2025": [
        { name: "New Year's Day", date: "2025-01-01", type: "optional", description: "First day of the year" },
        { name: "Guru Gobind Singh Jayanti", date: "2025-01-06", type: "restricted", description: "Birthday of Guru Gobind Singh" },
        { name: "Makar Sankranti / Pongal", date: "2025-01-14", type: "restricted", description: "Harvest festival" },
        { name: "Republic Day", date: "2025-01-26", type: "national", description: "National Gazetted Holiday" },
        { name: "Maha Shivratri", date: "2025-02-26", type: "national", description: "Lord Shiva festival" },
        { name: "Holika Dahan", date: "2025-03-13", type: "restricted", description: "Eve of Holi" },
        { name: "Holi", date: "2025-03-14", type: "national", description: "Festival of colours" },
        { name: "Id-ul-Fitr (Ramzan Eid)", date: "2025-03-31", type: "national", description: "Islamic festival ending Ramadan" },
        { name: "Ram Navami", date: "2025-04-06", type: "restricted", description: "Lord Rama's Birthday" },
        { name: "Mahavir Jayanti", date: "2025-04-10", type: "national", description: "Jain festival" },
        { name: "Ambedkar Jayanti", date: "2025-04-14", type: "national", description: "Dr. B.R. Ambedkar's Birthday" },
        { name: "Good Friday", date: "2025-04-18", type: "national", description: "Christian holiday" },
        { name: "Buddha Purnima", date: "2025-05-12", type: "national", description: "Gautam Buddha's Birthday" },
        { name: "Bakrid / Eid-ul-Adha", date: "2025-06-07", type: "national", description: "Feast of the Sacrifice" },
        { name: "Muharram", date: "2025-07-06", type: "national", description: "First month of Islamic calendar" },
        { name: "Independence Day", date: "2025-08-15", type: "national", description: "India Independence Day" },
        { name: "Raksha Bandhan", date: "2025-08-09", type: "restricted", description: "Sibling festival" },
        { name: "Janmashtami", date: "2025-08-16", type: "national", description: "Lord Krishna's Birthday" },
        { name: "Milad-un-Nabi", date: "2025-09-05", type: "national", description: "Prophet Muhammad's Birthday" },
        { name: "Mahatma Gandhi Jayanti", date: "2025-10-02", type: "national", description: "Father of the Nation Birthday" },
        { name: "Dussehra (Vijayadashami)", date: "2025-10-02", type: "national", description: "Victory of good over evil" },
        { name: "Diwali (Deepavali)", date: "2025-10-20", type: "national", description: "Festival of lights" },
        { name: "Govardhan Puja", date: "2025-10-22", type: "restricted", description: "Govardhan Puja / Annakut" },
        { name: "Bhai Dooj", date: "2025-10-23", type: "restricted", description: "Bhai Dooj festival" },
        { name: "Chhath Puja", date: "2025-10-28", type: "restricted", description: "Sun God festival" },
        { name: "Guru Nanak Jayanti", date: "2025-11-05", type: "national", description: "Guru Nanak's Birthday" },
        { name: "Christmas", date: "2025-12-25", type: "national", description: "Christmas Day" }
    ],
    "2026": [
        { name: "New Year's Day", date: "2026-01-01", type: "optional", description: "First day of the year" },
        { name: "Makar Sankranti / Pongal", date: "2026-01-14", type: "restricted", description: "Harvest festival" },
        { name: "Republic Day", date: "2026-01-26", type: "national", description: "National Gazetted Holiday" },
        { name: "Maha Shivratri", date: "2026-02-15", type: "national", description: "Lord Shiva festival" },
        { name: "Holi", date: "2026-03-04", type: "national", description: "Festival of colours" },
        { name: "Id-ul-Fitr (Eid)", date: "2026-03-20", type: "national", description: "Islamic festival ending Ramadan" },
        { name: "Ram Navami", date: "2026-03-28", type: "restricted", description: "Lord Rama's Birthday" },
        { name: "Mahavir Jayanti", date: "2026-03-31", type: "national", description: "Jain festival" },
        { name: "Good Friday", date: "2026-04-03", type: "national", description: "Christian holiday" },
        { name: "Ambedkar Jayanti", date: "2026-04-14", type: "national", description: "Dr. B.R. Ambedkar's Birthday" },
        { name: "Buddha Purnima", date: "2026-05-01", type: "national", description: "Gautam Buddha's Birthday" },
        { name: "Bakrid / Eid-ul-Adha", date: "2026-05-27", type: "national", description: "Feast of the Sacrifice" },
        { name: "Muharram", date: "2026-06-26", type: "national", description: "First month of Islamic calendar" },
        { name: "Independence Day", date: "2026-08-15", type: "national", description: "India Independence Day" },
        { name: "Milad-un-Nabi", date: "2026-08-26", type: "national", description: "Prophet Muhammad's Birthday" },
        { name: "Raksha Bandhan", date: "2026-08-28", type: "restricted", description: "Sibling festival" },
        { name: "Janmashtami", date: "2026-09-04", type: "national", description: "Lord Krishna's Birthday" },
        { name: "Mahatma Gandhi Jayanti", date: "2026-10-02", type: "national", description: "Father of the Nation Birthday" },
        { name: "Dussehra (Vijayadashami)", date: "2026-10-20", type: "national", description: "Victory of good over evil" },
        { name: "Diwali (Deepavali)", date: "2026-11-08", type: "national", description: "Festival of lights" },
        { name: "Govardhan Puja", date: "2026-11-10", type: "restricted", description: "Govardhan Puja / Annakut" },
        { name: "Bhai Dooj", date: "2026-11-11", type: "restricted", description: "Bhai Dooj festival" },
        { name: "Chhath Puja", date: "2026-11-16", type: "restricted", description: "Sun God festival" },
        { name: "Guru Nanak Jayanti", date: "2026-11-24", type: "national", description: "Guru Nanak's Birthday" },
        { name: "Christmas", date: "2026-12-25", type: "national", description: "Christmas Day" }
    ],
    "2027": [
        { name: "New Year's Day", date: "2027-01-01", type: "optional", description: "First day of the year" },
        { name: "Makar Sankranti / Pongal", date: "2027-01-14", type: "restricted", description: "Harvest festival" },
        { name: "Republic Day", date: "2027-01-26", type: "national", description: "National Gazetted Holiday" },
        { name: "Maha Shivratri", date: "2027-03-06", type: "national", description: "Lord Shiva festival" },
        { name: "Id-ul-Fitr (Eid)", date: "2027-03-10", type: "national", description: "Islamic festival ending Ramadan" },
        { name: "Holi", date: "2027-03-22", type: "national", description: "Festival of colours" },
        { name: "Good Friday", date: "2027-03-26", type: "national", description: "Christian holiday" },
        { name: "Ram Navami", date: "2027-04-16", type: "restricted", description: "Lord Rama's Birthday" },
        { name: "Ambedkar Jayanti", date: "2027-04-14", type: "national", description: "Dr. B.R. Ambedkar's Birthday" },
        { name: "Mahavir Jayanti", date: "2027-04-19", type: "national", description: "Jain festival" },
        { name: "Buddha Purnima", date: "2027-05-20", type: "national", description: "Gautam Buddha's Birthday" },
        { name: "Bakrid / Eid-ul-Adha", date: "2027-05-17", type: "national", description: "Feast of the Sacrifice" },
        { name: "Muharram", date: "2027-06-16", type: "national", description: "First month of Islamic calendar" },
        { name: "Independence Day", date: "2027-08-15", type: "national", description: "India Independence Day" },
        { name: "Milad-un-Nabi", date: "2027-08-15", type: "national", description: "Prophet Muhammad's Birthday" },
        { name: "Raksha Bandhan", date: "2027-08-17", type: "restricted", description: "Sibling festival" },
        { name: "Janmashtami", date: "2027-08-24", type: "national", description: "Lord Krishna's Birthday" },
        { name: "Mahatma Gandhi Jayanti", date: "2027-10-02", type: "national", description: "Father of the Nation Birthday" },
        { name: "Dussehra (Vijayadashami)", date: "2027-10-10", type: "national", description: "Victory of good over evil" },
        { name: "Diwali (Deepavali)", date: "2027-10-29", type: "national", description: "Festival of lights" },
        { name: "Govardhan Puja", date: "2027-10-31", type: "restricted", description: "Govardhan Puja / Annakut" },
        { name: "Bhai Dooj", date: "2027-11-01", type: "restricted", description: "Bhai Dooj festival" },
        { name: "Guru Nanak Jayanti", date: "2027-11-14", type: "national", description: "Guru Nanak's Birthday" },
        { name: "Christmas", date: "2027-12-25", type: "national", description: "Christmas Day" }
    ]
};

const getCompanyId = async (userId) => {
    const u = await User.findById(userId).select("companyId role").populate("role", "name");
    return { companyId: u?.companyId, isSuperAdmin: u?.role?.name === "super_admin" };
};

// GET /api/holidays?year=2025
export const getHolidays = async (req, res) => {
    try {
        const { year, companyId: qCompany } = req.query;
        const { companyId, isSuperAdmin } = await getCompanyId(req.user.userId);
        const filter = {};
        if (isSuperAdmin) {
            if (qCompany) filter.companyId = qCompany;
        } else {
            filter.$or = [
                { companyId: companyId },
                { companyId: null },
                { companyId: { $exists: false } }
            ];
        }
        if (year) filter.date = { $regex: `^${year}` };

        const holidays = await Holiday.find(filter)
            .populate("createdBy", "firstName lastName")
            .sort({ date: 1 });
        res.status(200).json({ holidays, success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// POST /api/holidays
export const createHoliday = async (req, res) => {
    try {
        const { name, date, description, type, companyId: bodyCompany } = req.body;
        const { companyId, isSuperAdmin } = await getCompanyId(req.user.userId);
        const resolvedCompany = isSuperAdmin && bodyCompany ? bodyCompany : companyId;

        if (!name || !date) return res.status(400).json({ message: "Name and date are required", success: false });

        const holiday = await Holiday.create({
            name, date, description, type,
            companyId: resolvedCompany,
            createdBy: req.user.userId,
        });

        // If resolvedCompany is null, notify all active users (global holiday)
        const filter = { isActive: true };
        if (resolvedCompany) filter.companyId = resolvedCompany;
        
        const users = await User.find(filter).select("_id");
        if (users.length > 0) {
            await createNotification({
                userId: users.map(u => u._id),
                title: "New Holiday Added 🎉",
                message: `${name} has been added as a holiday on ${date}.`,
                type: "system",
                link: "/holidays",
                createdBy: req.user.userId
            });
        }

        res.status(201).json({ holiday, message: "Holiday created", success: true });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ message: "Holiday already exists on this date", success: false });
        res.status(500).json({ message: err.message, success: false });
    }
};

// POST /api/holidays/bulk
export const bulkCreateHolidays = async (req, res) => {
    try {
        const { holidays, companyId: bodyCompany } = req.body;
        const { companyId, isSuperAdmin } = await getCompanyId(req.user.userId);
        const resolvedCompany = isSuperAdmin && bodyCompany ? bodyCompany : companyId;

        if (!Array.isArray(holidays) || !holidays.length)
            return res.status(400).json({ message: "holidays array is required", success: false });

        const docs = holidays.map(h => ({
            name: h.name, date: h.date, description: h.description,
            type: h.type || "national",
            companyId: resolvedCompany,
            createdBy: req.user.userId,
        }));

        const result = await Holiday.insertMany(docs, { ordered: false });

        const filter = { isActive: true };
        if (resolvedCompany) filter.companyId = resolvedCompany;
        
        const users = await User.find(filter).select("_id");
        if (users.length > 0 && result.length > 0) {
            await createNotification({
                userId: users.map(u => u._id),
                title: "New Holidays Added 🎉",
                message: `${result.length} new holiday(s) have been added to the calendar.`,
                type: "system",
                link: "/holidays",
                createdBy: req.user.userId
            });
        }

        res.status(201).json({ inserted: result.length, message: `${result.length} holidays added`, success: true });
    } catch (err) {
        // ordered:false — partial inserts possible; report what was inserted
        const inserted = err.result?.nInserted || 0;
        if (inserted > 0) return res.status(207).json({ inserted, message: `${inserted} holidays added (some duplicates skipped)`, success: true });
        res.status(500).json({ message: err.message, success: false });
    }
};

// POST /api/holidays/csv-upload  — parse CSV and bulk insert
export const csvUploadHolidays = async (req, res) => {
    try {
        const { companyId: bodyCompany } = req.body;
        const { companyId, isSuperAdmin } = await getCompanyId(req.user.userId);
        const resolvedCompany = isSuperAdmin && bodyCompany ? bodyCompany : companyId;

        if (!req.file) return res.status(400).json({ message: "CSV file is required", success: false });

        const csvText = req.file.buffer.toString("utf-8");
        const lines = csvText.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return res.status(400).json({ message: "CSV must have a header row and at least one data row", success: false });

        // Parse header: name, date, type (optional), description (optional)
        const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
        const nameIdx = headers.indexOf("name");
        const dateIdx = headers.indexOf("date");
        const typeIdx = headers.indexOf("type");
        const descIdx = headers.indexOf("description");

        if (nameIdx === -1 || dateIdx === -1)
            return res.status(400).json({ message: "CSV must have 'name' and 'date' columns", success: false });

        const validTypes = ["national", "optional", "restricted"];
        const docs = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
            const name = cols[nameIdx];
            const rawDate = cols[dateIdx];
            if (!name || !rawDate) { errors.push(`Row ${i + 1}: name and date are required`); continue; }

            // Accept both dd-mm-yyyy and yyyy-mm-dd
            let date;
            if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
                const [dd, mm, yyyy] = rawDate.split("-");
                date = `${yyyy}-${mm}-${dd}`;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                date = rawDate;
            } else {
                errors.push(`Row ${i + 1}: date must be dd-mm-yyyy or yyyy-mm-dd format`); continue;
            }

            const type = typeIdx !== -1 && validTypes.includes(cols[typeIdx]) ? cols[typeIdx] : "national";
            const description = descIdx !== -1 ? cols[descIdx] : "";
            docs.push({ name, date, description, type, companyId: resolvedCompany, createdBy: req.user.userId });
        }

        if (!docs.length) return res.status(400).json({ message: "No valid rows found", errors, success: false });

        let inserted = 0;
        try {
            const result = await Holiday.insertMany(docs, { ordered: false });
            inserted = result.length;
        } catch (bulkErr) {
            // ordered:false — partial inserts; nInserted counts successful ones
            inserted = bulkErr.result?.nInserted ?? bulkErr.insertedDocs?.length ?? 0;
            if (inserted === 0) return res.status(400).json({ message: "All rows failed (possibly duplicates)", errors, success: false });
        }

        const filter = { isActive: true };
        if (resolvedCompany) filter.companyId = resolvedCompany;
        
        const users = await User.find(filter).select("_id");
        if (users.length > 0 && inserted > 0) {
            await createNotification({
                userId: users.map(u => u._id),
                title: "New Holidays Added 🎉",
                message: `${inserted} new holiday(s) have been added to the calendar.`,
                type: "system",
                link: "/holidays",
                createdBy: req.user.userId
            });
        }

        res.status(201).json({ inserted, skipped: docs.length - inserted, errors, message: `${inserted} holiday${inserted !== 1 ? "s" : ""} imported`, success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// PUT /api/holidays/:id
export const updateHoliday = async (req, res) => {
    try {
        const { name, date, description, type } = req.body;
        const holiday = await Holiday.findById(req.params.id);
        if (!holiday) return res.status(404).json({ message: "Holiday not found", success: false });
        if (name) holiday.name = name;
        if (date) holiday.date = date;
        if (description !== undefined) holiday.description = description;
        if (type) holiday.type = type;
        holiday.updatedBy = req.user.userId;
        await holiday.save();

        const filter = { isActive: true };
        if (holiday.companyId) filter.companyId = holiday.companyId;
        const users = await User.find(filter).select("_id");
        if (users.length > 0) {
            await createNotification({
                userId: users.map(u => u._id),
                title: "Holiday Updated 🗓️",
                message: `The holiday "${holiday.name}" on ${holiday.date} has been updated.`,
                type: "system",
                link: "/holidays",
                createdBy: req.user.userId
            });
        }

        res.status(200).json({ holiday, message: "Holiday updated", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// DELETE /api/holidays/:id
export const deleteHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndDelete(req.params.id);
        if (holiday) {
            const filter = { isActive: true };
            if (holiday.companyId) filter.companyId = holiday.companyId;
            const users = await User.find(filter).select("_id");
            if (users.length > 0) {
                await createNotification({
                    userId: users.map(u => u._id),
                    title: "Holiday Cancelled ❌",
                    message: `The holiday "${holiday.name}" on ${holiday.date} has been cancelled.`,
                    type: "system",
                    link: "/holidays",
                    createdBy: req.user.userId
                });
            }
        }
        res.status(200).json({ message: "Holiday deleted", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// POST /api/holidays/auto-sync-india
export const autoSyncIndianHolidays = async (req, res) => {
    try {
        const { year: qYear, companyId: bodyCompany } = req.body;
        const targetYear = String(qYear || new Date().getFullYear());
        const { companyId, isSuperAdmin } = await getCompanyId(req.user.userId);
        const resolvedCompany = isSuperAdmin && bodyCompany ? bodyCompany : companyId;

        let holidaysToSync = [];

        // 1. First check if master list has predefined full list (gazetted + cultural)
        if (INDIAN_HOLIDAYS_MASTER[targetYear]) {
            holidaysToSync = [...INDIAN_HOLIDAYS_MASTER[targetYear]];
        }

        // 2. Try fetching from public holidays API to augment / get latest
        try {
            const apiRes = await axios.get(`https://date.nager.at/api/v3/publicholidays/${targetYear}/IN`, { timeout: 3000 });
            if (Array.isArray(apiRes.data) && apiRes.data.length > 0) {
                apiRes.data.forEach(item => {
                    if (!holidaysToSync.some(h => h.date === item.date)) {
                        holidaysToSync.push({
                            name: item.localName || item.name,
                            date: item.date,
                            type: item.types?.includes("Optional") ? "optional" : "national",
                            description: item.name || "Government Gazetted Holiday"
                        });
                    }
                });
            }
        } catch (apiErr) {
            // Offline/sandbox/timeout fallback
        }

        // Fallback for any other year
        if (holidaysToSync.length === 0) {
            holidaysToSync = [
                { name: "Republic Day", date: `${targetYear}-01-26`, type: "national", description: "National Gazetted Holiday" },
                { name: "Ambedkar Jayanti", date: `${targetYear}-04-14`, type: "national", description: "Dr. B.R. Ambedkar's Birthday" },
                { name: "Independence Day", date: `${targetYear}-08-15`, type: "national", description: "India Independence Day" },
                { name: "Mahatma Gandhi Jayanti", date: `${targetYear}-10-02`, type: "national", description: "Father of the Nation Birthday" },
                { name: "Christmas", date: `${targetYear}-12-25`, type: "national", description: "Christmas Day" }
            ];
        }

        let addedCount = 0;
        let skippedCount = 0;

        for (const item of holidaysToSync) {
            const query = {
                date: item.date,
                companyId: resolvedCompany
            };

            const existing = await Holiday.findOne(query);
            if (!existing) {
                await Holiday.create({
                    name: item.name,
                    date: item.date,
                    type: item.type || "national",
                    description: item.description || "Indian Holiday",
                    companyId: resolvedCompany,
                    createdBy: req.user.userId
                });
                addedCount++;
            } else {
                skippedCount++;
            }
        }

        // Create notification for users
        if (addedCount > 0) {
            const filter = { isActive: true };
            if (resolvedCompany) filter.companyId = resolvedCompany;
            const users = await User.find(filter).select("_id");
            if (users.length > 0) {
                await createNotification({
                    userId: users.map(u => u._id),
                    title: `Indian Holidays (${targetYear}) Synced 🎉`,
                    message: `${addedCount} Indian government & cultural holidays have been marked for ${targetYear}.`,
                    type: "system",
                    link: "/holidays",
                    createdBy: req.user.userId
                });
            }
        }

        res.status(200).json({
            success: true,
            addedCount,
            skippedCount,
            totalSynced: holidaysToSync.length,
            message: `Successfully synced ${addedCount} Indian holidays for ${targetYear} (${skippedCount} already existed).`
        });
    } catch (err) {
        console.error("Auto sync Indian holidays error:", err);
        res.status(500).json({ message: err.message, success: false });
    }
};
