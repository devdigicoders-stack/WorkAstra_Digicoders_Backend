import mongoose from "mongoose";

const assetTypeSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Asset type name is required"],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

// Compound index so asset type name is unique per company (or null for global)
assetTypeSchema.index({ name: 1, companyId: 1 }, { unique: true });

const AssetType = mongoose.models.AssetType || mongoose.model("AssetType", assetTypeSchema);

export default AssetType;
