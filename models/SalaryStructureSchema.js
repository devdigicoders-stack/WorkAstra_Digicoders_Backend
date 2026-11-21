import mongoose from "mongoose";

// Each component: Basic, HRA, Conveyance, Medical, Special Allowance, etc.
const componentSchema = new mongoose.Schema({
    name:       { type: String, required: true },  // "Basic", "HRA", "PF", etc.
    type:       { type: String, enum: ["earning", "deduction"], required: true },
    calcType:   { type: String, enum: ["fixed", "percentage"], default: "fixed" },
    value:      { type: mongoose.Schema.Types.Mixed, required: true },   // amount or % of basic (supports encrypted string)
    taxable:    { type: Boolean, default: true },
}, { _id: false });

const SalaryStructureSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId:  { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    effectiveFrom: { type: String, required: true }, // "YYYY-MM-DD"
    ctc:        { type: mongoose.Schema.Types.Mixed, required: true },    // annual CTC (supports encrypted string)
    basic:      { type: mongoose.Schema.Types.Mixed, required: true },    // monthly basic (supports encrypted string)
    components: { type: [componentSchema], default: [] },
    // Computed monthly totals (supports encrypted strings)
    grossEarnings:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    totalDeductions:{ type: mongoose.Schema.Types.Mixed, default: 0 },
    netSalary:      { type: mongoose.Schema.Types.Mixed, default: 0 },
    isActive:   { type: Boolean, default: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

SalaryStructureSchema.index({ userId: 1, effectiveFrom: -1 });

export default mongoose.model("SalaryStructure", SalaryStructureSchema);
