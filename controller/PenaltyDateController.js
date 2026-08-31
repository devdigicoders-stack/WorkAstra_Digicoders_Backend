import PenaltyDate from "../models/PenaltyDateSchema.js";
import User from "../models/UserSchema.js";

// POST /api/penalty-dates — Add a new penalty date
export const addPenaltyDate = async (req, res) => {
    try {
        const { date, reason, penaltyMultiplier } = req.body;
        if (!date || !reason || !penaltyMultiplier) {
            return res.status(400).json({ message: "date, reason, and penaltyMultiplier are required", success: false });
        }
        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const companyId = reqUser.role?.name === "super_admin" ? null : reqUser.companyId;

        const existing = await PenaltyDate.findOne({ date, companyId });
        if (existing) {
            return res.status(400).json({ message: "A penalty date already exists for this date", success: false });
        }

        const penaltyDate = await PenaltyDate.create({
            date, reason, penaltyMultiplier, companyId, createdBy: req.user.userId
        });
        res.status(201).json({ message: "Penalty date added successfully", penaltyDate, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// GET /api/penalty-dates — Get all penalty dates
export const getPenaltyDates = async (req, res) => {
    try {
        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const filter = {};
        if (reqUser.role?.name !== "super_admin") {
            filter.$or = [{ companyId: reqUser.companyId }, { companyId: null }];
        }
        const penaltyDates = await PenaltyDate.find(filter).sort({ date: -1 }).lean();
        res.json({ penaltyDates, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// DELETE /api/penalty-dates/:id — Remove a penalty date
export const deletePenaltyDate = async (req, res) => {
    try {
        await PenaltyDate.findByIdAndDelete(req.params.id);
        res.json({ message: "Penalty date deleted successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};
