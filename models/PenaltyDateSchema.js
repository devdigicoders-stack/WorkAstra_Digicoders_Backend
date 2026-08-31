import mongoose from "mongoose";

const PenaltyDateSchema = new mongoose.Schema({
    date: { type: String, required: true },
    reason: { type: String, required: true },
    penaltyMultiplier: { type: Number, required: true, min: 1, max: 10, default: 2 },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

PenaltyDateSchema.index({ date: 1, companyId: 1 }, { unique: true });

export default mongoose.model("PenaltyDate", PenaltyDateSchema);
