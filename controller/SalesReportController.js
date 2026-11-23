import Lead from "../models/LeadSchema.js";
import Quote from "../models/QuoteSchema.js";
import Meeting from "../models/MeetingSchema.js";
import User from "../models/UserSchema.js";
import Company from "../models/CompanySchema.js";
import mongoose from "mongoose";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";

// Helper to reliably get company ID
const cid = (req) => {
    const c = req.user?.company || req.user?.companyId;
    return c ? new mongoose.Types.ObjectId(c) : null;
};

export const getSalesReport = async (req, res) => {
    try {
        const { startDate, endDate, employeeId, companyId: queryCompanyId } = req.query;
        const user = await User.findById(req.user.userId).populate("role");
        const roleName = user?.role?.name || req.user.role;

        let matchCompanyId = null;
        if (roleName === "super_admin") {
            if (queryCompanyId && queryCompanyId !== "all") {
                matchCompanyId = new mongoose.Types.ObjectId(queryCompanyId);
            }
        } else {
            matchCompanyId = cid(req);
        }

        let baseMatch = {};
        if (matchCompanyId) {
            baseMatch.companyId = matchCompanyId;
        }

        // Date Range Filter
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            // If end date is YYYY-MM-DD without time, ensure end of day
            if (endDate.length === 10) {
                end.setHours(23, 59, 59, 999);
            }
            baseMatch.createdAt = {
                $gte: start,
                $lte: end
            };
        }

        let leadMatchQuery = { ...baseMatch };
        let meetingMatchQuery = { ...baseMatch };
        let quoteMatchQuery = { ...baseMatch };

        // Employee (BDE) Specific Filter
        if (employeeId && employeeId !== "all") {
            const targetEmpId = new mongoose.Types.ObjectId(employeeId);
            leadMatchQuery.assignedTo = targetEmpId;
            meetingMatchQuery.assignedTo = targetEmpId;

            // Quotes for leads assigned to this employee OR created by this employee
            const empLeadIds = await Lead.find({ assignedTo: targetEmpId, ...(matchCompanyId ? { companyId: matchCompanyId } : {}) }).distinct("_id");
            quoteMatchQuery.$or = [
                { leadId: { $in: empLeadIds } },
                { createdBy: targetEmpId }
            ];
        } else {
            // Role Hierarchy based filtering
            if (roleName === "admin") {
                const allowedIds = await getSubordinateIds(req.user.userId);
                const allTeamIds = [...allowedIds, new mongoose.Types.ObjectId(req.user.userId)];
                leadMatchQuery.assignedTo = { $in: allTeamIds };
                meetingMatchQuery.assignedTo = { $in: allTeamIds };

                const teamLeadIds = await Lead.find({ assignedTo: { $in: allTeamIds }, ...(matchCompanyId ? { companyId: matchCompanyId } : {}) }).distinct("_id");
                quoteMatchQuery.$or = [
                    { leadId: { $in: teamLeadIds } },
                    { createdBy: { $in: allTeamIds } }
                ];
            } else if (roleName !== "super_admin") {
                const myId = new mongoose.Types.ObjectId(req.user.userId);
                leadMatchQuery.assignedTo = myId;
                meetingMatchQuery.assignedTo = myId;

                const myLeadIds = await Lead.find({ assignedTo: myId, ...(matchCompanyId ? { companyId: matchCompanyId } : {}) }).distinct("_id");
                quoteMatchQuery.$or = [
                    { leadId: { $in: myLeadIds } },
                    { createdBy: myId }
                ];
            }
        }

        // 1. Total Leads
        const totalLeads = await Lead.countDocuments(leadMatchQuery);

        // 2. Converted Leads ("Project Done")
        const totalConversions = await Lead.countDocuments({ 
            ...leadMatchQuery, 
            status: "Project Done"
        });

        // 3. Meetings Done
        const totalMeetings = await Meeting.countDocuments({
            ...meetingMatchQuery,
            status: "Completed"
        });

        // 4. Quotes Sent & Accepted Revenue
        const totalQuotesSent = await Quote.countDocuments({
            ...quoteMatchQuery,
            status: { $in: ["sent", "accepted", "rejected"] }
        });

        const acceptedQuotes = await Quote.find({
            ...quoteMatchQuery,
            status: "accepted"
        });
        const totalRevenue = acceptedQuotes.reduce((sum, q) => sum + (q.grandTotal || 0), 0);
        const conversionRate = totalLeads > 0 ? Math.round((totalConversions / totalLeads) * 100) : 0;
        const avgDealValue = totalConversions > 0 ? Math.round(totalRevenue / totalConversions) : 0;

        // 5. BDE Performance Aggregation
        const leadAgg = await Lead.aggregate([
            { $match: leadMatchQuery },
            { 
                $group: { 
                    _id: "$assignedTo", 
                    leadsCreated: { $sum: 1 },
                    leadsConverted: { $sum: { $cond: [{ $eq: ["$status", "Project Done"] }, 1, 0] } }
                } 
            }
        ]);

        const quoteAgg = await Quote.aggregate([
            { $match: { ...quoteMatchQuery, status: "accepted" } },
            {
                $lookup: {
                    from: "leads",
                    localField: "leadId",
                    foreignField: "_id",
                    as: "lead"
                }
            },
            {
                $group: {
                    _id: { $ifNull: [{ $arrayElemAt: ["$lead.assignedTo", 0] }, "$createdBy"] },
                    revenue: { $sum: "$grandTotal" }
                }
            }
        ]);

        const meetingAgg = await Meeting.aggregate([
            { $match: { ...meetingMatchQuery, status: "Completed" } },
            {
                $group: { 
                    _id: "$assignedTo", 
                    meetingsDone: { $sum: 1 }
                } 
            }
        ]);

        // Merge performance data
        const performanceMap = {};
        const ensureBDE = (id) => {
            if (!id) return;
            const key = id.toString();
            if (!performanceMap[key]) {
                performanceMap[key] = { userId: key, leadsCreated: 0, leadsConverted: 0, revenue: 0, meetingsDone: 0 };
            }
        };

        leadAgg.forEach(item => {
            if (item._id) {
                ensureBDE(item._id);
                performanceMap[item._id.toString()].leadsCreated = item.leadsCreated;
                performanceMap[item._id.toString()].leadsConverted = item.leadsConverted;
            }
        });

        quoteAgg.forEach(item => {
            if (item._id) {
                ensureBDE(item._id);
                performanceMap[item._id.toString()].revenue = item.revenue;
            }
        });

        meetingAgg.forEach(item => {
            if (item._id) {
                ensureBDE(item._id);
                performanceMap[item._id.toString()].meetingsDone = item.meetingsDone;
            }
        });

        const userIds = Object.keys(performanceMap);
        const users = await User.find({ _id: { $in: userIds } }).select("firstName lastName email profilePic");
        
        const bdePerformance = users.map(u => ({
            userId: u._id,
            name: `${u.firstName} ${u.lastName}`,
            email: u.email,
            profilePic: u.profilePic?.url || null,
            ...performanceMap[u._id.toString()]
        })).sort((a, b) => b.revenue - a.revenue);

        // 6. Lead Status Breakdown (Funnel distribution)
        const leadStatusAgg = await Lead.aggregate([
            { $match: leadMatchQuery },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);
        const leadStatusBreakdown = leadStatusAgg.map(s => ({
            name: s._id || "Unknown",
            value: s.count
        }));

        // 7. Monthly Trend Aggregation
        const monthlyLeads = await Lead.aggregate([
            { $match: leadMatchQuery },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    leads: { $sum: 1 },
                    conversions: { $sum: { $cond: [{ $eq: ["$status", "Project Done"] }, 1, 0] } }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        const monthlyQuotes = await Quote.aggregate([
            { $match: { ...quoteMatchQuery, status: "accepted" } },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    revenue: { $sum: "$grandTotal" }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const trendMap = {};

        monthlyLeads.forEach(item => {
            const y = item._id.year;
            const m = item._id.month;
            const key = `${y}-${String(m).padStart(2, '0')}`;
            trendMap[key] = {
                key,
                month: `${monthNames[m]} ${y}`,
                leads: item.leads,
                conversions: item.conversions,
                revenue: 0
            };
        });

        monthlyQuotes.forEach(item => {
            const y = item._id.year;
            const m = item._id.month;
            const key = `${y}-${String(m).padStart(2, '0')}`;
            if (!trendMap[key]) {
                trendMap[key] = {
                    key,
                    month: `${monthNames[m]} ${y}`,
                    leads: 0,
                    conversions: 0,
                    revenue: 0
                };
            }
            trendMap[key].revenue = item.revenue;
        });

        const monthlyTrend = Object.values(trendMap).sort((a, b) => a.key.localeCompare(b.key));

        // 8. Employees list for frontend filter dropdown
        let empQuery = { isActive: true };
        if (matchCompanyId) {
            empQuery.companyId = matchCompanyId;
        }
        if (roleName === "admin") {
            const allowedIds = await getSubordinateIds(req.user.userId);
            empQuery._id = { $in: [...allowedIds, req.user.userId] };
        } else if (roleName !== "super_admin") {
            empQuery._id = req.user.userId;
        }

        const employees = await User.find(empQuery)
            .select("firstName lastName email")
            .sort({ firstName: 1 });

        res.json({
            success: true,
            summary: {
                totalLeads,
                totalConversions,
                totalMeetings,
                totalQuotesSent,
                totalRevenue,
                conversionRate,
                avgDealValue
            },
            bdePerformance,
            leadStatusBreakdown,
            monthlyTrend,
            employees: employees.map(e => ({
                _id: e._id,
                name: `${e.firstName} ${e.lastName}`,
                email: e.email
            }))
        });

    } catch (error) {
        console.error("SalesReport Error:", error);
        res.status(500).json({ success: false, message: error.message, stack: error.stack });
    }
};
