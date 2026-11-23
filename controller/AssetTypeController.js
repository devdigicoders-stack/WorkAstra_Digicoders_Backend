import AssetType from "../models/AssetTypeSchema.js";
import Asset from "../models/AssetSchema.js";
import Company from "../models/CompanySchema.js";
import User from "../models/UserSchema.js";

// Helper to reliably get user's company ID
const getCompanyId = async (req) => {
    if (req.user?.company) return req.user.company;
    if (req.user?.companyId) return req.user.companyId;
    if (req.user?.userId) {
        const u = await User.findById(req.user.userId).select("companyId");
        return u?.companyId || null;
    }
    return null;
};

// Auto-heal existing unlinked asset types and drop old legacy unique index on name
const autoHealUnlinkedAssetTypes = async () => {
    try {
        // Drop legacy global unique name index if exists
        await AssetType.collection.dropIndex("name_1").catch(() => {});

        // Link existing asset types that have companyId = null to their creator's company
        const unlinked = await AssetType.find({ companyId: null }).populate({
            path: "createdBy",
            select: "companyId role",
            populate: { path: "role", select: "name" }
        });

        for (const item of unlinked) {
            if (item.createdBy && item.createdBy.companyId) {
                const creatorRole = item.createdBy.role?.name || item.createdBy.role;
                if (creatorRole !== "super_admin") {
                    await AssetType.updateOne(
                        { _id: item._id },
                        { $set: { companyId: item.createdBy.companyId } }
                    );
                }
            }
        }
    } catch (e) {
        console.error("autoHealUnlinkedAssetTypes error:", e.message);
    }
};

// GET /api/asset-types
export const getAllAssetTypes = async (req, res) => {
    try {
        await autoHealUnlinkedAssetTypes();

        const isSuperAdmin = req.user.role === 'super_admin';
        const userCompanyId = await getCompanyId(req);

        let query = {};
        if (isSuperAdmin) {
            if (req.query.companyId && req.query.companyId !== 'all') {
                if (req.query.companyId === 'global') {
                    query = { companyId: null };
                } else {
                    query = {
                        $or: [
                            { companyId: req.query.companyId },
                            { companyId: null }
                        ]
                    };
                }
            }
        } else {
            // Company Admin / HR / User: strictly their company types + global types
            query = {
                $or: [
                    { companyId: userCompanyId },
                    { companyId: null }
                ]
            };
        }

        const types = await AssetType.find(query)
            .populate("companyId", "name")
            .populate("createdBy", "name email")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, assetTypes: types });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/asset-types
export const createAssetType = async (req, res) => {
    try {
        await autoHealUnlinkedAssetTypes();
        const { name, description, companyId } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Asset Type name is required" });
        }

        const isSuperAdmin = req.user.role === 'super_admin';
        const userCompanyId = await getCompanyId(req);
        const targetCompanyId = isSuperAdmin
            ? (companyId && companyId !== 'all' && companyId !== 'global' ? companyId : null)
            : userCompanyId;

        // Check uniqueness within the same company scope
        const existingQuery = {
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
            companyId: targetCompanyId ? targetCompanyId : null
        };
        const existing = await AssetType.findOne(existingQuery);
        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Asset Type "${name.trim()}" already exists for this company`
            });
        }

        const type = await AssetType.create({
            name: name.trim(),
            description: description ? description.trim() : "",
            companyId: targetCompanyId,
            createdBy: req.user.userId
        });

        const populated = await AssetType.findById(type._id)
            .populate("companyId", "name")
            .populate("createdBy", "name email");

        res.status(201).json({ success: true, message: "Asset Type created successfully", assetType: populated });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Asset Type already exists for this company" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /api/asset-types/:id
export const updateAssetType = async (req, res) => {
    try {
        const { name, description, companyId } = req.body;
        const type = await AssetType.findById(req.params.id);
        
        if (!type) return res.status(404).json({ success: false, message: "Asset Type not found" });

        const isSuperAdmin = req.user.role === 'super_admin';
        const userCompanyId = await getCompanyId(req);

        // Cross-company security check
        if (!isSuperAdmin) {
            if (type.companyId && type.companyId.toString() !== userCompanyId?.toString()) {
                return res.status(403).json({ success: false, message: "Unauthorized to update asset type from another company" });
            }
            if (!type.companyId) {
                return res.status(403).json({ success: false, message: "Only Super Admin can update global asset types" });
            }
        }

        const targetCompanyId = isSuperAdmin && companyId !== undefined
            ? (companyId && companyId !== 'all' && companyId !== 'global' ? companyId : null)
            : type.companyId;

        if (name && name.trim() !== type.name) {
            const existing = await AssetType.findOne({
                _id: { $ne: type._id },
                name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
                companyId: targetCompanyId ? targetCompanyId : null
            });
            if (existing) {
                return res.status(400).json({ success: false, message: `Asset Type "${name.trim()}" already exists for this company` });
            }
            
            // Update Assets using this type for this company
            const assetQuery = { type: type.name };
            if (targetCompanyId) assetQuery.companyId = targetCompanyId;
            await Asset.updateMany(assetQuery, { type: name.trim() });
            
            type.name = name.trim();
        }

        if (description !== undefined) type.description = description ? description.trim() : "";
        if (isSuperAdmin && companyId !== undefined) {
            type.companyId = targetCompanyId;
        }

        await type.save();

        const populated = await AssetType.findById(type._id)
            .populate("companyId", "name")
            .populate("createdBy", "name email");

        res.status(200).json({ success: true, message: "Asset Type updated successfully", assetType: populated });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Asset Type already exists for this company" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /api/asset-types/:id
export const deleteAssetType = async (req, res) => {
    try {
        const type = await AssetType.findById(req.params.id);
        if (!type) return res.status(404).json({ success: false, message: "Asset Type not found" });

        const isSuperAdmin = req.user.role === 'super_admin';
        const userCompanyId = await getCompanyId(req);

        // Cross-company security check
        if (!isSuperAdmin) {
            if (type.companyId && type.companyId.toString() !== userCompanyId?.toString()) {
                return res.status(403).json({ success: false, message: "Unauthorized to delete asset type from another company" });
            }
            if (!type.companyId) {
                return res.status(403).json({ success: false, message: "Only Super Admin can delete global asset types" });
            }
        }

        const assetQuery = { type: type.name };
        if (type.companyId) assetQuery.companyId = type.companyId;
        const inUse = await Asset.findOne(assetQuery);
        if (inUse) {
            return res.status(400).json({ success: false, message: "Cannot delete because assets exist with this type" });
        }

        await AssetType.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: "Asset Type deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
