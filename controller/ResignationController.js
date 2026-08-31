import Resignation from "../models/ResignationSchema.js";
import User from "../models/UserSchema.js";
import PayrollRun from "../models/PayrollRunSchema.js";
import SalaryStructure from "../models/SalaryStructureSchema.js";
import { createNotification } from "../utills/notificationHelper.js";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";
import { generateExperienceLetterPDF } from "../utills/experienceLetterGenerator.js";
import { generateSalarySlipsPDF } from "../utills/salarySlipGenerator.js";

// POST /api/resignations
export const submitResignation = async (req, res) => {
    try {
        const { reason, requestedLastWorkingDay } = req.body;
        const userId = req.user.userId;

        // Check if already has a pending or approved resignation
        const existing = await Resignation.findOne({ 
            employeeId: userId, 
            status: { $in: ["Pending", "Approved"] } 
        });

        if (existing) {
            return res.status(400).json({ message: "You already have an active resignation request.", success: false });
        }

        const user = await User.findById(userId).select("companyId");
        
        const resignation = new Resignation({
            employeeId: userId,
            companyId: user?.companyId || req.user.companyId || null,
            reason,
            requestedLastWorkingDay,
            createdBy: userId
        });

        await resignation.save();

        const submittingUser = await User.findById(userId);
        
        // Notify Admins
        const admins = await User.find({ 
            $or: [ { companyId: submittingUser?.companyId }, { companyId: null } ]
        }).populate("role");
        
        const adminIds = admins.filter(a => 
            a.role?.name === "super_admin" || 
            a.role?.name === "admin" || 
            a.role?.permissions?.includes("MANAGE_RESIGNATIONS")
        ).map(a => a._id);

        if (adminIds.length > 0) {
            await createNotification({
                userId: adminIds,
                title: "New Resignation Request",
                message: `${submittingUser?.firstName} ${submittingUser?.lastName} has submitted a resignation request.`,
                type: "system",
                link: "/manage-resignations"
            });
        }

        res.status(201).json({ message: "Resignation submitted successfully.", resignation, success: true });
    } catch (error) {
        console.error("SUBMIT RESIGNATION ERROR:", error);
        res.status(500).json({ message: "Error submitting resignation.", error: error.message, success: false });
    }
};

// POST /api/resignations/admin-exit
export const adminSubmitExit = async (req, res) => {
    try {
        const { employeeId, reason, approvedLastWorkingDay } = req.body;
        const adminId = req.user.userId;

        if (!employeeId || !approvedLastWorkingDay) {
            return res.status(400).json({ message: "Employee ID and Last Working Day are required.", success: false });
        }

        // Check if already has a pending or approved resignation
        const existing = await Resignation.findOne({ 
            employeeId: employeeId, 
            status: { $in: ["Pending", "Approved"] } 
        });

        if (existing) {
            return res.status(400).json({ message: "Employee already has an active exit/resignation record.", success: false });
        }

        const employee = await User.findById(employeeId).select("companyId firstName lastName");
        if (!employee) {
            return res.status(404).json({ message: "Employee not found.", success: false });
        }
        
        const resignation = new Resignation({
            employeeId: employeeId,
            companyId: employee.companyId || req.user.companyId || null,
            reason: reason || "Initiated by Admin",
            requestedLastWorkingDay: approvedLastWorkingDay,
            approvedLastWorkingDay: approvedLastWorkingDay,
            status: "Approved", // Auto-approved
            createdBy: adminId,
            updatedBy: adminId
        });

        await resignation.save();

        // Notify Employee via FCM/In-App
        await createNotification({
            userId: employeeId,
            title: "Exit Initiated",
            message: `Your exit has been initiated with the last working day as ${new Date(approvedLastWorkingDay).toLocaleDateString()}.`,
            type: "system",
            link: "/my-resignation"
        });

        res.status(201).json({ message: "Exit initiated successfully.", resignation, success: true });
    } catch (error) {
        console.error("ADMIN SUBMIT EXIT ERROR:", error);
        res.status(500).json({ message: "Error initiating exit.", error: error.message, success: false });
    }
};

// GET /api/resignations/my-resignation
export const getMyResignation = async (req, res) => {
    try {
        const userId = req.user.userId;
        const resignations = await Resignation.find({ employeeId: userId })
            .populate({
                path: "employeeId",
                select: "firstName lastName email profilePic employeeCode designation department createdAt",
                populate: [
                    { path: "department", select: "name" },
                    { path: "designation", select: "name" }
                ]
            })
            .sort({ createdAt: -1 });

        res.status(200).json({ resignations, success: true });
    } catch (error) {
        console.error("GET MY RESIGNATION ERROR:", error);
        res.status(500).json({ message: "Error fetching resignation details.", error: error.message, success: false });
    }
};

// GET /api/resignations
export const getAllResignations = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate("role");
        const isSuperAdmin = user?.role?.name === "super_admin";

        let query = {};
        if (isSuperAdmin) {
            // Super Admin sees all
        } else {
            // Hierarchy filter: only see resignations of subordinates
            const allowedIds = await getSubordinateIds(req.user.userId);
            query.employeeId = { $in: allowedIds };
        }

        const resignations = await Resignation.find(query)
            .populate("employeeId", "firstName lastName email profilePic employeeCode designation department")
            .populate({
                path: "employeeId",
                populate: [
                    { path: "department", select: "name" },
                    { path: "designation", select: "name" }
                ]
            })
            .sort({ createdAt: -1 });

        res.status(200).json({ resignations, success: true });
    } catch (error) {
        console.error("GET ALL RESIGNATIONS ERROR:", error);
        res.status(500).json({ message: "Error fetching resignations.", error: error.message, success: false });
    }
};

// PATCH /api/resignations/:id/status
export const updateResignationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks, approvedLastWorkingDay, reason } = req.body;

        const resignation = await Resignation.findById(id);
        if (!resignation) {
            return res.status(404).json({ message: "Resignation not found.", success: false });
        }

        if (status) resignation.status = status;
        if (remarks !== undefined) resignation.remarks = remarks;
        if (reason !== undefined) resignation.reason = reason;
        if (approvedLastWorkingDay) {
            resignation.approvedLastWorkingDay = approvedLastWorkingDay;
            resignation.requestedLastWorkingDay = approvedLastWorkingDay; // Keep them in sync for admin
        }
        
        resignation.updatedBy = req.user.userId;
        await resignation.save();

        const updated = await Resignation.findById(id)
            .populate("employeeId", "firstName lastName email profilePic");

        const dateFormatted = updated.approvedLastWorkingDay ? new Date(updated.approvedLastWorkingDay).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pending';

        // Notify Employee via FCM/In-App
        await createNotification({
            userId: updated.employeeId._id,
            title: status ? `Resignation ${status}` : 'Exit Record Updated',
            message: status ? `Your resignation request has been ${status.toLowerCase()}.` : `Your exit details have been updated. Last Working Day: ${dateFormatted}.`,
            type: "system",
            link: "/my-resignation"
        });

        res.status(200).json({ message: `Record updated successfully.`, resignation: updated, success: true });
    } catch (error) {
        console.error("UPDATE RESIGNATION STATUS ERROR:", error);
        res.status(500).json({ message: "Error updating resignation.", error: error.message, success: false });
    }
};

// DELETE /api/resignations/:id
export const deleteResignation = async (req, res) => {
    try {
        const { id } = req.params;
        const resignation = await Resignation.findById(id);
        if (!resignation) {
            return res.status(404).json({ message: "Resignation not found.", success: false });
        }

        await Resignation.findByIdAndDelete(id);

        await createNotification({
            userId: resignation.employeeId,
            title: 'Exit Request Revoked',
            message: 'Your exit request has been revoked by the administrator.',
            type: "system",
            link: "/"
        });

        res.status(200).json({ message: "Exit record deleted successfully.", success: true });
    } catch (error) {
        console.error("DELETE RESIGNATION ERROR:", error);
        res.status(500).json({ message: "Error deleting exit record.", error: error.message, success: false });
    }
};

// PATCH /api/resignations/:id/clearance
export const processClearance = async (req, res) => {
    try {
        const { id } = req.params;

        const resignation = await Resignation.findById(id);
        if (!resignation) {
            return res.status(404).json({ message: "Resignation not found.", success: false });
        }

        if (resignation.status !== "Approved") {
            return res.status(400).json({ message: "Cannot process clearance for an unapproved resignation.", success: false });
        }

        resignation.clearanceStatus = "Completed";
        resignation.updatedBy = req.user.userId;
        await resignation.save();

        // Deactivate the user
        await User.findByIdAndUpdate(resignation.employeeId, { isActive: false });

        await createNotification({
            userId: resignation.employeeId,
            title: 'Clearance Completed',
            message: 'Your exit clearance has been completed successfully.',
            type: "system",
            link: "/"
        });

        res.status(200).json({ message: "Clearance completed. Employee account deactivated.", success: true });
    } catch (error) {
        console.error("PROCESS CLEARANCE ERROR:", error);
        res.status(500).json({ message: "Error processing clearance.", error: error.message, success: false });
    }
};

// PATCH /api/resignations/:id/restore
export const restoreEmployee = async (req, res) => {
    try {
        const { id } = req.params;

        const resignation = await Resignation.findById(id);
        if (!resignation) {
            return res.status(404).json({ message: "Resignation not found.", success: false });
        }

        // Reactivate the user
        await User.findByIdAndUpdate(resignation.employeeId, { isActive: true });

        // Delete the resignation record so the exit is completely cancelled
        await Resignation.findByIdAndDelete(id);

        await createNotification({
            userId: resignation.employeeId,
            title: 'Employment Restored',
            message: 'Your employment status has been restored successfully.',
            type: "system",
            link: "/"
        });

        res.status(200).json({ message: "Employee restored and exit record removed successfully.", success: true });
    } catch (error) {
        console.error("RESTORE EMPLOYEE ERROR:", error);
        res.status(500).json({ message: "Error restoring employee.", error: error.message, success: false });
    }
};

// GET /api/resignations/:id/experience-letter

export const downloadExperienceLetter = async (req, res) => {
    try {
        const { id } = req.params;

        const resignation = await Resignation.findById(id).populate({
            path: 'employeeId',
            populate: [
                { path: 'designation' },
                { path: 'department' },
                { path: 'companyId' },
                { path: 'role' }
            ]
        });

        if (!resignation) {
            return res.status(404).json({ message: "Resignation not found.", success: false });
        }

        if (resignation.status !== "Approved") {
            return res.status(400).json({ message: "Experience letter can only be generated for approved resignations.", success: false });
        }

        const user = resignation.employeeId;
        if (!user) {
            return res.status(404).json({ message: "Employee details not found.", success: false });
        }

        const pdfBuffer = await generateExperienceLetterPDF(user, resignation);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${user.firstName}_${user.lastName}_Experience_Letter.pdf"`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);
    } catch (error) {
        console.error("DOWNLOAD EXPERIENCE LETTER ERROR:", error);
        res.status(500).json({ message: "Error generating experience letter.", error: error.message, success: false });
    }
};

// GET /api/resignations/:id/salary-slips
export const downloadSalarySlips = async (req, res) => {
    try {
        const { id } = req.params;
        const resignation = await Resignation.findById(id).populate({
            path: 'employeeId',
            populate: [
                { path: 'designation' },
                { path: 'department' },
                { path: 'companyId' },
                { path: 'role' }
            ]
        });

        if (!resignation) {
            return res.status(404).json({ message: "Resignation record not found", success: false });
        }
        if (resignation.status !== "Approved") {
            return res.status(400).json({ message: "Salary slips can only be generated for approved resignations", success: false });
        }

        const user = resignation.employeeId;

        // Fetch last 3 months payroll runs for this user
        let payrollRuns = await PayrollRun.find({ userId: user._id, status: { $in: ["approved", "paid"] } })
                                          .sort({ month: -1 })
                                          .limit(3)
                                          .lean();

        // If fewer than 3, generate dummies using SalaryStructure
        if (payrollRuns.length < 3) {
            const structure = await SalaryStructure.findOne({ userId: user._id, isActive: true }).lean();
            if (structure) {
                // Determine the starting month to walk backwards from
                const endDate = resignation.approvedLastWorkingDay ? new Date(resignation.approvedLastWorkingDay) : new Date();
                
                let currentMonthObj = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
                
                while (payrollRuns.length < 3) {
                    const monthStr = `${currentMonthObj.getFullYear()}-${String(currentMonthObj.getMonth() + 1).padStart(2, '0')}`;
                    
                    if (!payrollRuns.find(r => r.month === monthStr)) {
                        const components = [
                            { name: "Basic", type: "earning", amount: structure.basic },
                            ...(structure.components || []).map(c => ({
                                name: c.name,
                                type: c.type,
                                amount: c.calcType === "percentage"
                                    ? parseFloat(((c.value / 100) * structure.basic).toFixed(2))
                                    : c.value,
                            }))
                        ];
                        
                        const grossEarnings = components.filter(c => c.type === "earning").reduce((s, c) => s + c.amount, 0);
                        const totalDeductions = components.filter(c => c.type === "deduction").reduce((s, c) => s + c.amount, 0);
                        const netSalary = grossEarnings - totalDeductions;
                        
                        payrollRuns.push({
                            month: monthStr,
                            components,
                            grossEarnings,
                            totalDeductions,
                            netSalary
                        });
                    }
                    
                    // Move to previous month
                    currentMonthObj.setMonth(currentMonthObj.getMonth() - 1);
                }
            }
        }
        
        // Sort chronologically (oldest first so it generates pages in order, or newest first)
        // Let's do newest first
        payrollRuns.sort((a, b) => b.month.localeCompare(a.month));

        const pdfBuffer = await generateSalarySlipsPDF(user, payrollRuns);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${user.firstName}_${user.lastName}_3Months_Salary_Slip.pdf"`,
            'Content-Length': pdfBuffer.length
        });
        
        res.send(pdfBuffer);
    } catch (error) {
        console.error("Error generating salary slips:", error);
        res.status(500).json({ message: "Error generating salary slips", error: error.message, success: false });
    }
};
