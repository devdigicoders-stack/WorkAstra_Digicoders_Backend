import Branch from "../models/BranchSchema.js";
import User from "../models/UserSchema.js";

// POST /api/branches
export const createBranch = async (req, res) => {
    try {
        const { name, address, location, geofenceRadius } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: "Branch name is required", success: false });

        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const companyId = reqUser.role?.name === "super_admin" ? req.body.companyId : reqUser.companyId;
        if (!companyId) return res.status(400).json({ message: "Company is required", success: false });

        const branch = await Branch.create({
            name: name.trim(), companyId, address: address?.trim() || null,
            location: location || { latitude: null, longitude: null },
            geofenceRadius: geofenceRadius || 100,
            createdBy: req.user.userId,
        });
        res.status(201).json({ message: "Branch created successfully", branch, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// GET /api/branches
export const getBranches = async (req, res) => {
    try {
        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const filter = reqUser.role?.name === "super_admin" ? {} : { companyId: reqUser.companyId };
        const branches = await Branch.find(filter).populate("companyId", "name").sort({ createdAt: -1 });
        res.status(200).json({ branches, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// GET /api/branches/by-company/:companyId
export const getBranchesByCompany = async (req, res) => {
    try {
        const branches = await Branch.find({ companyId: req.params.companyId, isActive: true }).sort({ name: 1 });
        res.status(200).json({ branches, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// PUT /api/branches/:id
export const updateBranch = async (req, res) => {
    try {
        const { name, address, location, geofenceRadius, isActive } = req.body;
        const branch = await Branch.findById(req.params.id);
        if (!branch) return res.status(404).json({ message: "Branch not found", success: false });

        if (name) branch.name = name.trim();
        if (address !== undefined) branch.address = address;
        if (location) branch.location = location;
        if (geofenceRadius !== undefined) branch.geofenceRadius = geofenceRadius;
        if (isActive !== undefined) branch.isActive = isActive;

        await branch.save();
        res.status(200).json({ message: "Branch updated successfully", branch, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// DELETE /api/branches/:id
export const deleteBranch = async (req, res) => {
    try {
        const branch = await Branch.findByIdAndDelete(req.params.id);
        if (!branch) return res.status(404).json({ message: "Branch not found", success: false });
        // Remove branch from all users
        await User.updateMany({ branch: req.params.id }, { $set: { branch: null } });
        res.status(200).json({ message: "Branch deleted successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};
