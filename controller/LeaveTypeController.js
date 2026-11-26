import LeaveType from "../models/leaveTypeSchema.js";
import User from "../models/UserSchema.js";

const getCaller = (userId) =>
    User.findById(userId).select("companyId branch role").populate("role", "name");

const buildBranchScopeFilter = (caller) => {
    const roleName = caller?.role?.name;
    if (roleName === "super_admin") return {};
    if (roleName === "admin") return { companyId: caller.companyId };

    // Non-admin (Branch Head / Employee): see only own branch leave types + company-wide (branchId: null)
    const branchOr = [{ branchId: null }, { branchId: { $exists: false } }];
    if (caller?.branch) {
        branchOr.unshift({ branchId: caller.branch });
    }
    return { companyId: caller.companyId, $or: branchOr };
};

// GET /api/leave-types
export const getLeaveTypes = async (req, res) => {
    try {
        const caller = await getCaller(req.user.userId);
        if (!caller) return res.status(404).json({ message: "User not found", success: false });

        const filter = { isDeleted: false, ...buildBranchScopeFilter(caller) };
        const types = await LeaveType.find(filter)
            .populate("companyId", "name")
            .populate("branchId", "name")
            .populate("createdBy", "firstName lastName")
            .populate("updatedBy", "firstName lastName")
            .sort({ name: 1 });
        res.status(200).json({ leaveTypes: types, success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// GET /api/leave-types/by-company/:companyId
export const getLeaveTypesByCompany = async (req, res) => {
    try {
        const caller = await getCaller(req.user.userId);
        if (!caller) return res.status(404).json({ message: "User not found", success: false });

        const roleName = caller?.role?.name;
        const filter = { companyId: req.params.companyId, isDeleted: false, status: true };

        if (roleName !== "super_admin" && roleName !== "admin") {
            const branchOr = [{ branchId: null }, { branchId: { $exists: false } }];
            if (caller?.branch) branchOr.unshift({ branchId: caller.branch });
            filter.$or = branchOr;
        } else if (req.query.branchId) {
            filter.$or = [{ branchId: req.query.branchId }, { branchId: null }, { branchId: { $exists: false } }];
        }

        const types = await LeaveType.find(filter)
            .populate("branchId", "name")
            .sort({ name: 1 });
        res.status(200).json({ leaveTypes: types, success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// POST /api/leave-types
export const createLeaveType = async (req, res) => {
    try {
        const { name, code, description, defaultDays, isPaid, carryForward, maxCarryForward, companyId: bodyCompany, branchId: bodyBranch } = req.body;
        if (!name || !code) return res.status(400).json({ message: "Name and code are required", success: false });

        const caller = await getCaller(req.user.userId);
        if (!caller) return res.status(404).json({ message: "User not found", success: false });

        const roleName = caller?.role?.name;
        const isSuperAdmin = roleName === "super_admin";
        const isAdmin = roleName === "admin";

        const companyId = isSuperAdmin && bodyCompany ? bodyCompany : caller.companyId;
        // Admin / Super Admin can create company-wide (null) or choose a branch;
        // Branch Head / non-admin is locked to their own branch.
        const branchId = (isSuperAdmin || isAdmin)
            ? (bodyBranch || null)
            : (caller.branch || null);

        const lt = await LeaveType.create({
            name,
            code: code.toUpperCase(),
            description,
            defaultDays,
            isPaid,
            carryForward,
            maxCarryForward,
            companyId,
            branchId,
            createdBy: req.user.userId,
        });

        const populated = await LeaveType.findById(lt._id)
            .populate("companyId", "name")
            .populate("branchId", "name");

        res.status(201).json({ leaveType: populated, message: "Leave type created", success: true });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ message: "Leave type code already exists for this branch/company", success: false });
        res.status(500).json({ message: err.message, success: false });
    }
};

// PUT /api/leave-types/:id
export const updateLeaveType = async (req, res) => {
    try {
        const { name, code, description, defaultDays, isPaid, carryForward, maxCarryForward, status, branchId } = req.body;
        const lt = await LeaveType.findById(req.params.id);
        if (!lt || lt.isDeleted) return res.status(404).json({ message: "Leave type not found", success: false });

        const caller = await getCaller(req.user.userId);
        if (!caller) return res.status(404).json({ message: "User not found", success: false });

        const roleName = caller?.role?.name;
        const isSuperAdmin = roleName === "super_admin";
        const isAdmin = roleName === "admin";

        if (!isSuperAdmin) {
            if (String(lt.companyId) !== String(caller.companyId)) {
                return res.status(403).json({ message: "Not authorized to update leave types from another company", success: false });
            }
            if (!isAdmin) {
                if (!caller.branch || !lt.branchId || String(lt.branchId) !== String(caller.branch)) {
                    return res.status(403).json({ message: "You can only edit leave types belonging to your own branch", success: false });
                }
            }
        }

        if (name) lt.name = name;
        if (code) lt.code = code.toUpperCase();
        if (description !== undefined) lt.description = description;
        if (defaultDays !== undefined) lt.defaultDays = defaultDays;
        if (isPaid !== undefined) lt.isPaid = isPaid;
        if (carryForward !== undefined) lt.carryForward = carryForward;
        if (maxCarryForward !== undefined) lt.maxCarryForward = maxCarryForward;
        if (status !== undefined) lt.status = status;
        if ((isSuperAdmin || isAdmin) && branchId !== undefined) {
            lt.branchId = branchId || null;
        }
        lt.updatedBy = req.user.userId;
        await lt.save();

        const populated = await LeaveType.findById(lt._id)
            .populate("companyId", "name")
            .populate("branchId", "name");

        res.status(200).json({ leaveType: populated, message: "Leave type updated", success: true });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ message: "Leave type code already exists for this branch/company", success: false });
        res.status(500).json({ message: err.message, success: false });
    }
};

// DELETE /api/leave-types/:id
export const deleteLeaveType = async (req, res) => {
    try {
        const lt = await LeaveType.findById(req.params.id);
        if (!lt || lt.isDeleted) return res.status(404).json({ message: "Leave type not found", success: false });

        const caller = await getCaller(req.user.userId);
        if (!caller) return res.status(404).json({ message: "User not found", success: false });

        const roleName = caller?.role?.name;
        const isSuperAdmin = roleName === "super_admin";
        const isAdmin = roleName === "admin";

        if (!isSuperAdmin) {
            if (String(lt.companyId) !== String(caller.companyId)) {
                return res.status(403).json({ message: "Not authorized to delete leave types from another company", success: false });
            }
            if (!isAdmin) {
                if (!caller.branch || !lt.branchId || String(lt.branchId) !== String(caller.branch)) {
                    return res.status(403).json({ message: "You can only delete leave types belonging to your own branch", success: false });
                }
            }
        }

        lt.isDeleted = true;
        lt.updatedBy = req.user.userId;
        await lt.save();
        res.status(200).json({ message: "Leave type deleted", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};
