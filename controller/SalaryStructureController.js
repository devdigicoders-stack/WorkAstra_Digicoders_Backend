import SalaryStructure from "../models/SalaryStructureSchema.js";
import User from "../models/UserSchema.js";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";
import jwt from "jsonwebtoken";
import { encryptSalaryStructure, decryptSalaryStructure, maskSalaryStructure } from "../utills/cryptoHelper.js";

// Verify if request includes an authenticated payroll unlock token
const isPayrollTokenValid = (req) => {
    const token = req.headers["x-payroll-token"];
    if (!token) return false;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "Tom_and_Jerry");
        return !!decoded?.unlocked;
    } catch {
        return false;
    }
};

// Compute monthly totals from components + basic
const computeTotals = (basic, components) => {
    let grossEarnings = basic;
    let totalDeductions = 0;

    components.forEach(c => {
        const numVal = Number(c.value) || 0;
        const amount = c.calcType === "percentage" ? parseFloat(((numVal / 100) * basic).toFixed(2)) : numVal;
        if (c.type === "earning") grossEarnings += amount;
        else totalDeductions += amount;
    });

    return {
        grossEarnings: parseFloat(grossEarnings.toFixed(2)),
        totalDeductions: parseFloat(totalDeductions.toFixed(2)),
        netSalary: parseFloat((grossEarnings - totalDeductions).toFixed(2)),
    };
};

// POST /api/payroll/salary-structure
export const createSalaryStructure = async (req, res) => {
    try {
        const { userId, effectiveFrom, ctc, basic, components } = req.body;
        if (!userId || !effectiveFrom || !ctc || !basic)
            return res.status(400).json({ message: "userId, effectiveFrom, ctc and basic are required", success: false });

        const reqUser = await User.findById(req.user.userId).select("companyId");
        const targetUser = await User.findById(userId).select("companyId");
        if (!targetUser) return res.status(404).json({ message: "Employee not found", success: false });

        // Deactivate previous active structure for this employee
        await SalaryStructure.updateMany({ userId, isActive: true }, { $set: { isActive: false } });

        const plainBasic = Number(basic);
        const plainCtc = Number(ctc);
        const plainComponents = (components || []).map(c => ({ ...c, value: Number(c.value) }));
        const totals = computeTotals(plainBasic, plainComponents);

        // Encrypt with AES-256 before saving to DB
        const encryptedData = encryptSalaryStructure({
            userId,
            companyId: targetUser.companyId,
            effectiveFrom,
            ctc: plainCtc,
            basic: plainBasic,
            components: plainComponents,
            ...totals,
            createdBy: req.user.userId,
        });

        const structure = await SalaryStructure.create(encryptedData);

        res.status(201).json({ structure: decryptSalaryStructure(structure), message: "Salary structure created", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// PUT /api/payroll/salary-structure/:id
export const updateSalaryStructure = async (req, res) => {
    try {
        const { effectiveFrom, ctc, basic, components } = req.body;
        const structure = await SalaryStructure.findById(req.params.id);
        if (!structure) return res.status(404).json({ message: "Salary structure not found", success: false });

        const current = decryptSalaryStructure(structure);
        const newEffectiveFrom = effectiveFrom !== undefined ? effectiveFrom : current.effectiveFrom;
        const newCtc = ctc !== undefined ? Number(ctc) : current.ctc;
        const newBasic = basic !== undefined ? Number(basic) : current.basic;
        const newComponents = components !== undefined 
            ? components.map(c => ({ ...c, value: Number(c.value) })) 
            : (current.components || []);

        const totals = computeTotals(newBasic, newComponents);

        structure.effectiveFrom = newEffectiveFrom;
        structure.ctc = newCtc;
        structure.basic = newBasic;
        structure.components = newComponents;
        Object.assign(structure, totals);
        structure.updatedBy = req.user.userId;

        // Encrypt with AES-256 before saving
        encryptSalaryStructure(structure);
        await structure.save();

        res.status(200).json({ structure: decryptSalaryStructure(structure), message: "Salary structure updated", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// GET /api/payroll/salary-structure/user/:userId
export const getUserSalaryStructures = async (req, res) => {
    try {
        const structures = await SalaryStructure.find({ userId: req.params.userId })
            .populate("userId", "firstName lastName employeeCode")
            .sort({ effectiveFrom: -1 });

        const unlocked = isPayrollTokenValid(req);
        const formatted = structures.map(s => unlocked ? decryptSalaryStructure(s) : maskSalaryStructure(s));

        res.status(200).json({ structures: formatted, success: true, isMasked: !unlocked });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// GET /api/payroll/salary-structure/company  — all active structures for company
export const getCompanySalaryStructures = async (req, res) => {
    try {
        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const filter = { isActive: true };

        if (reqUser.role?.name === "super_admin") {
            // Super Admin sees all salary structures
        } else {
            // Hierarchy filter:
            // Admin B1 sees salary structures of B1's team only
            // Admin B2's team salary structures are NOT visible to Admin B1
            const allowedIds = await getSubordinateIds(req.user.userId);
            filter.userId = { $in: allowedIds };
        }

        const structures = await SalaryStructure.find(filter)
            .populate("userId", "firstName lastName employeeCode department designation profilePic")
            .sort({ createdAt: -1 });

        const unlocked = isPayrollTokenValid(req);
        const formatted = structures.map(s => unlocked ? decryptSalaryStructure(s) : maskSalaryStructure(s));

        res.status(200).json({ structures: formatted, success: true, isMasked: !unlocked });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};

// DELETE /api/payroll/salary-structure/:id
export const deleteSalaryStructure = async (req, res) => {
    try {
        await SalaryStructure.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Salary structure deleted", success: true });
    } catch (err) {
        res.status(500).json({ message: err.message, success: false });
    }
};
