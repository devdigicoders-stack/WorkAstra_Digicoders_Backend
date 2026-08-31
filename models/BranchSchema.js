import mongoose from "mongoose";

const BranchSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    address: { type: String, default: null, trim: true },
    location: {
        latitude:  { type: Number, default: null },
        longitude: { type: Number, default: null },
    },
    geofenceRadius: { type: Number, default: 100 }, // meters
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

export default mongoose.model("Branch", BranchSchema);
