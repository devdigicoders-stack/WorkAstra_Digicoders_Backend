import Payment from "../models/PaymentSchema.js";
import SystemSettings from "../models/SystemSettingsSchema.js";
import User from "../models/UserSchema.js";
import Project from "../models/ProjectSchema.js";
import { uploadToCloudinary } from "../middleware/multer.js";
import { createNotification } from "../utills/notificationHelper.js";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";
import { encryptField, decryptField, encryptPaymentRecord, decryptPaymentRecord } from "../utills/cryptoHelper.js";

// Update global UPI details
export const updateUpiDetails = async (req, res) => {
    try {
        const { upiId, payeeName } = req.body;
        if (!upiId) {
            return res.status(400).json({ message: "UPI ID is required", success: false });
        }
        
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = new SystemSettings();
        }

        settings.upiDetails = { upiId, payeeName };
        settings.updatedBy = req.user.userId;

        await settings.save();
        res.status(200).json({ message: "UPI Details updated successfully", success: true, data: settings.upiDetails });
    } catch (error) {
        console.error("Error updating UPI details:", error);
        res.status(500).json({ message: "Failed to update UPI details", success: false });
    }
};

// Get global UPI details
export const getUpiDetails = async (req, res) => {
    try {
        const settings = await SystemSettings.findOne();
        if (!settings || !settings.upiDetails?.upiId) {
            return res.status(404).json({ message: "UPI details not found", success: false });
        }
        res.status(200).json({ success: true, upiDetails: settings.upiDetails });
    } catch (error) {
        console.error("Error fetching UPI details:", error);
        res.status(500).json({ message: "Failed to fetch UPI details", success: false });
    }
};

// User submits a payment
export const submitPayment = async (req, res) => {
    try {
        const { amount, transactionId, remark, projectId } = req.body;
        const userId = req.user.userId;

        if (!req.file) {
            return res.status(400).json({ message: "Payment screenshot is required", success: false });
        }
        if (!amount || !transactionId) {
            return res.status(400).json({ message: "Amount and Transaction ID are required", success: false });
        }

        const user = await User.findById(userId).select("companyId");
        const companyId = req.user.company || user?.companyId;

        const screenshot = await uploadToCloudinary(req.file, "payments");

        let validProjectId = null;
        if (projectId && projectId !== "null" && projectId !== "undefined" && projectId !== "") {
            validProjectId = projectId;
        }

        const payment = new Payment({
            userId,
            companyId,
            projectId: validProjectId,
            amount: encryptField(Number(amount)),
            transactionId: encryptField(transactionId),
            remark,
            screenshot: {
                url: screenshot.url,
                publicId: screenshot.publicId
            }
        });

        await payment.save();

        // Notify admins about the new payment
        try {
            const admins = await User.find({ "role": { $exists: true } }).populate("role");
            const notifyAdminIds = admins
                .filter(u => u.role?.name === "super_admin" || (u.role?.permissions || []).includes("MANAGE_PAYMENTS"))
                .filter(u => !u.companyId || u.companyId.toString() === companyId?.toString())
                .map(u => u._id);

            if (notifyAdminIds.length > 0) {
                const userObj = await User.findById(userId).select("firstName lastName");
                let projectText = "";
                if (validProjectId) {
                    const proj = await Project.findById(validProjectId).select("name");
                    if (proj) projectText = ` for project "${proj.name}"`;
                }

                await createNotification({
                    userId: notifyAdminIds,
                    title: "New Payment Uploaded",
                    message: `${userObj?.firstName || "A client"} uploaded a new payment of ₹${amount}${projectText}.`,
                    type: "system",
                    createdBy: userId
                });
            }
        } catch (notifErr) {
            console.error("Notification error in submitPayment:", notifErr);
        }

        res.status(201).json({ message: "Payment submitted successfully", success: true, payment: decryptPaymentRecord(payment) });
    } catch (error) {
        console.error("Error submitting payment:", error);
        res.status(500).json({ message: "Failed to submit payment", success: false });
    }
};

// User gets their own payments
export const getMyPayments = async (req, res) => {
    try {
        const userId = req.user.userId;
        const payments = await Payment.find({ userId })
            .populate("projectId", "name price receivedAmount status")
            .sort({ createdAt: -1 });
        const decryptedPayments = payments.map(p => decryptPaymentRecord(p));
        res.status(200).json({ success: true, payments: decryptedPayments });
    } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ message: "Failed to fetch payments", success: false });
    }
};

// Admin gets all payments
export const getAllPayments = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate("role");
        const isSuperAdmin = req.user.role === 'super_admin' || user?.role?.name === 'super_admin';

        let filter = {};
        if (!isSuperAdmin) {
            let companyId = req.user.company || user?.companyId;
            if (companyId) {
                filter.companyId = companyId;
            } else {
                return res.status(200).json({ success: true, payments: [] });
            }
        }

        const payments = await Payment.find(filter)
            .populate("userId", "firstName lastName email profilePic")
            .populate("reviewedBy", "firstName lastName")
            .populate("projectId", "name price receivedAmount status")
            .sort({ createdAt: -1 });

        const decryptedPayments = payments.map(p => decryptPaymentRecord(p));
        res.status(200).json({ success: true, payments: decryptedPayments });
    } catch (error) {
        console.error("Error fetching all payments:", error);
        res.status(500).json({ message: "Failed to fetch all payments", success: false });
    }
};

// Admin updates payment status
export const updatePaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const reviewedBy = req.user.userId;

        if (!["pending", "approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid status", success: false });
        }

        const user = await User.findById(req.user.userId).populate("role");
        const isSuperAdmin = req.user.role === 'super_admin' || user?.role?.name === 'super_admin';

        let filter = { _id: id };
        if (!isSuperAdmin) {
            let companyId = req.user.company || user?.companyId;
            if (companyId) {
                filter.companyId = companyId;
            } else {
                return res.status(404).json({ message: "Payment not found", success: false });
            }
        }

        const payment = await Payment.findOne(filter);
        if (!payment) {
            return res.status(404).json({ message: "Payment not found", success: false });
        }

        payment.status = status;
        payment.reviewedBy = reviewedBy;
        payment.reviewedAt = new Date();

        await payment.save();

        // If payment is linked to a project, recalculate project receivedAmount
        if (payment.projectId) {
            const approvedPayments = await Payment.find({
                projectId: payment.projectId,
                status: "approved"
            });
            const totalReceived = approvedPayments.reduce((sum, p) => sum + (Number(decryptField(p.amount)) || 0), 0);
            await Project.findByIdAndUpdate(payment.projectId, { receivedAmount: encryptField(totalReceived) });
        }

        // Notify user about payment status
        try {
            const readableAmount = decryptField(payment.amount);
            await createNotification({
                userId: payment.userId,
                title: `Payment ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                message: `Your payment of ₹${readableAmount} has been ${status}.`,
                type: "system",
                createdBy: reviewedBy
            });
        } catch (notifErr) {
            console.error("Notification error in updatePaymentStatus:", notifErr);
        }

        res.status(200).json({ message: `Payment ${status} successfully`, success: true, payment: decryptPaymentRecord(payment) });
    } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).json({ message: "Failed to update payment status", success: false });
    }
};

// Super Admin / Admin gets project finance summary
export const getProjectFinances = async (req, res) => {
    try {
        const isSuperAdmin = req.user.role === "super_admin";
        const hasAdminPerm = (req.user.permissions || []).some(p =>
            ["MANAGE_PAYMENTS", "VIEW_ALL_PROJECTS", "CREATE_PROJECT"].includes(p)
        );

        let filter = { isDeleted: false };
        if (!isSuperAdmin) {
            const allowedIds = await getSubordinateIds(req.user.userId);
            if (hasAdminPerm) {
                filter.$or = [
                    { members: { $in: allowedIds } },
                    { createdBy: { $in: allowedIds } }
                ];
            } else {
                filter.$or = [
                    { members: req.user.userId },
                    { createdBy: req.user.userId },
                    { clientIds: req.user.userId }
                ];
            }
        }

        const projects = await Project.find(filter)
            .populate("clientIds", "firstName lastName email profilePic")
            .populate("createdBy", "firstName lastName")
            .sort({ createdAt: -1 })
            .lean();

        const projectIds = projects.map(p => p._id);
        const payments = await Payment.find({
            projectId: { $in: projectIds }
        })
            .populate("userId", "firstName lastName email")
            .sort({ createdAt: -1 })
            .lean();

        // Group payments by project
        const projectPaymentsMap = {};
        payments.forEach(pay => {
            const pid = pay.projectId?.toString();
            if (!projectPaymentsMap[pid]) {
                projectPaymentsMap[pid] = { approved: 0, pending: 0, count: 0, items: [] };
            }
            const decAmount = Number(decryptField(pay.amount)) || 0;
            if (pay.status === "approved") {
                projectPaymentsMap[pid].approved += decAmount;
            } else if (pay.status === "pending") {
                projectPaymentsMap[pid].pending += decAmount;
            }
            projectPaymentsMap[pid].count += 1;
            projectPaymentsMap[pid].items.push(decryptPaymentRecord(pay));
        });

        let totalValuation = 0;
        let totalReceived = 0;
        let totalDue = 0;
        let totalPendingApproval = 0;

        const enrichedProjects = projects.map(proj => {
            const pid = proj._id.toString();
            const payInfo = projectPaymentsMap[pid] || { approved: 0, pending: 0, count: 0, items: [] };
            const dealPrice = Number(decryptField(proj.price)) || 0;
            const received = payInfo.approved;
            const due = Math.max(0, dealPrice - received);

            totalValuation += dealPrice;
            totalReceived += received;
            totalDue += due;
            totalPendingApproval += payInfo.pending;

            let paymentStatus = "unpaid";
            if (dealPrice > 0) {
                if (received >= dealPrice) paymentStatus = "paid";
                else if (received > 0) paymentStatus = "partial";
            } else if (received > 0) {
                paymentStatus = "paid";
            }

            return {
                ...proj,
                price: dealPrice,
                receivedAmount: received,
                dueAmount: due,
                pendingApprovalAmount: payInfo.pending,
                paymentStatus,
                paymentsCount: payInfo.count,
                recentPayments: payInfo.items
            };
        });

        res.status(200).json({
            success: true,
            summary: {
                totalValuation,
                totalReceived,
                totalDue,
                totalPendingApproval,
                totalProjects: projects.length,
                fullyPaidProjects: enrichedProjects.filter(p => p.paymentStatus === "paid").length,
                partialProjects: enrichedProjects.filter(p => p.paymentStatus === "partial").length,
                unpaidProjects: enrichedProjects.filter(p => p.paymentStatus === "unpaid").length,
            },
            projects: enrichedProjects
        });
    } catch (error) {
        console.error("Error fetching project finances:", error);
        res.status(500).json({ message: "Failed to fetch project finances", success: false });
    }
};

// Get finances & payments for a specific client
export const getClientFinances = async (req, res) => {
    try {
        const { clientId } = req.params;
        const currentUserId = req.user.userId;
        const isSuperAdmin = req.user.role === "super_admin";
        const isAdmin = req.user.role === "admin";

        // Access check: super_admin, admin, permissions, or the client themselves
        if (!isSuperAdmin && !isAdmin && currentUserId !== clientId) {
            const hasPerm = (req.user.permissions || []).some(p =>
                ["MANAGE_PAYMENTS", "VIEW_ALL_PROJECTS", "CREATE_PROJECT"].includes(p)
            );
            if (!hasPerm) {
                return res.status(403).json({ success: false, message: "Unauthorized access to client finances" });
            }
        }

        // 1. Find all projects where this user is client (in clientIds or clientId)
        const projects = await Project.find({
            $or: [
                { clientIds: clientId },
                { clientId: clientId }
            ],
            isDeleted: false
        })
            .populate("createdBy", "firstName lastName")
            .populate("clientIds", "firstName lastName email profilePic")
            .sort({ createdAt: -1 })
            .lean();

        const projectIds = projects.map(p => p._id);

        // 2. Find all payments for this client: either userId === clientId OR projectId in client's projectIds
        const paymentFilter = projectIds.length > 0 
            ? { $or: [{ userId: clientId }, { projectId: { $in: projectIds } }] }
            : { userId: clientId };

        const payments = await Payment.find(paymentFilter)
            .populate("projectId", "name price status")
            .populate("userId", "firstName lastName email profilePic")
            .populate("reviewedBy", "firstName lastName")
            .sort({ createdAt: -1 })
            .lean();

        // 3. Map payments by project
        const projectPaymentsMap = {};
        payments.forEach(pay => {
            const pid = pay.projectId?._id?.toString() || pay.projectId?.toString();
            if (pid) {
                if (!projectPaymentsMap[pid]) {
                    projectPaymentsMap[pid] = { approved: 0, pending: 0, count: 0, items: [] };
                }
                const decAmount = Number(decryptField(pay.amount)) || 0;
                if (pay.status === "approved") {
                    projectPaymentsMap[pid].approved += decAmount;
                } else if (pay.status === "pending") {
                    projectPaymentsMap[pid].pending += decAmount;
                }
                projectPaymentsMap[pid].count += 1;
                projectPaymentsMap[pid].items.push(decryptPaymentRecord(pay));
            }
        });

        // 4. Enrich projects with finance calculations
        let totalValuation = 0;
        let totalReceived = 0;
        let totalDue = 0;
        let totalPendingApproval = 0;

        const enrichedProjects = projects.map(proj => {
            const pid = proj._id.toString();
            const payInfo = projectPaymentsMap[pid] || { approved: 0, pending: 0, count: 0, items: [] };
            const dealPrice = Number(decryptField(proj.price)) || 0;
            const received = payInfo.approved;
            const due = Math.max(0, dealPrice - received);

            totalValuation += dealPrice;
            totalReceived += received;
            totalDue += due;
            totalPendingApproval += payInfo.pending;

            let paymentStatus = "unpaid";
            if (dealPrice > 0) {
                if (received >= dealPrice) paymentStatus = "paid";
                else if (received > 0) paymentStatus = "partial";
            } else if (received > 0) {
                paymentStatus = "paid";
            }

            return {
                ...proj,
                price: dealPrice,
                receivedAmount: received,
                dueAmount: due,
                pendingApprovalAmount: payInfo.pending,
                paymentStatus,
                paymentsCount: payInfo.count,
                recentPayments: payInfo.items
            };
        });

        const decryptedPayments = payments.map(p => decryptPaymentRecord(p));

        res.status(200).json({
            success: true,
            summary: {
                totalValuation,
                totalReceived,
                totalDue,
                totalPendingApproval,
                totalProjects: projects.length,
                fullyPaidProjects: enrichedProjects.filter(p => p.paymentStatus === "paid").length,
                partialProjects: enrichedProjects.filter(p => p.paymentStatus === "partial").length,
                unpaidProjects: enrichedProjects.filter(p => p.paymentStatus === "unpaid").length,
            },
            projects: enrichedProjects,
            payments: decryptedPayments
        });
    } catch (error) {
        console.error("Error fetching client finances:", error);
        res.status(500).json({ success: false, message: "Failed to fetch client finances" });
    }
};
