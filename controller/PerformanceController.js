import Task from "../models/TaskSchema.js";
import Attendance from "../models/AttendanceSchema.js";
import User from "../models/UserSchema.js";
import Project from "../models/ProjectSchema.js";
import mongoose from "mongoose";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";

const cid = (req) => req.user.company ? new mongoose.Types.ObjectId(req.user.company) : null;

export const getPerformanceReport = async (req, res) => {
    try {
        const { startDate, endDate, month, allTime } = req.query;
        const companyId = cid(req);
        const reqUser = req.user;

        let matchQuery = { isDeleted: false };
        let attendanceMatch = {};
        
        const isAdmin = reqUser.role === "super_admin" || reqUser.role === "admin";
        
        // If not super_admin, filter attendance by companyId
        if (reqUser.role !== "super_admin" && companyId) {
            attendanceMatch.companyId = companyId;
        }

        // Apply date filters if provided, otherwise default to this month
        let start, end;
        let startStr, endStr;

        if (allTime === "true") {
            start = new Date(0);
            end = new Date();
            // No date restrictions on attendance
        } else if (month) {
            const [y, m] = month.split("-").map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            startStr = `${month}-01`;
            endStr = `${month}-${String(lastDay).padStart(2, "0")}`;
            start = new Date(`${startStr}T00:00:00.000+05:30`);
            end = new Date(`${endStr}T23:59:59.999+05:30`);
            attendanceMatch.date = { $gte: startStr, $lte: endStr };
        } else if (startDate && endDate) {
            startStr = startDate.includes("T") ? startDate.split("T")[0] : startDate;
            endStr = endDate.includes("T") ? endDate.split("T")[0] : endDate;
            start = new Date(`${startStr}T00:00:00.000+05:30`);
            end = new Date(`${endStr}T23:59:59.999+05:30`);
            attendanceMatch.date = { $gte: startStr, $lte: endStr };
        } else {
            const now = new Date();
            const year = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
            startStr = `${year}-${m}-01`;
            endStr = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
            start = new Date(`${startStr}T00:00:00.000+05:30`);
            end = new Date(`${endStr}T23:59:59.999+05:30`);
            attendanceMatch.date = { $gte: startStr, $lte: endStr };
        }

        const viewAll = isAdmin || (reqUser.permissions && reqUser.permissions.includes("VIEW_ALL_PERFORMANCE"));
        
        let usersToFetch = [];
        if (reqUser.role === "super_admin") {
            // Super Admin sees everyone across all companies
            usersToFetch = await User.find({ isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName profilePic role");
        } else if (reqUser.role === "admin") {
            // Company Admin sees all active employees of their company
            usersToFetch = await User.find({ companyId: companyId, isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName profilePic role");
        } else if (viewAll) {
            // Manager/Lead with VIEW_ALL_PERFORMANCE: hierarchy filter — their subordinates
            const allowedIds = await getSubordinateIds(reqUser.userId);
            usersToFetch = await User.find({ _id: { $in: allowedIds }, isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName profilePic role");
        } else {
            // Regular employee: only self
            const user = await User.findById(reqUser.userId)
                .populate("role", "name")
                .select("_id firstName lastName profilePic role");
            if (user) usersToFetch = [user];
        }

        // Exclude clients from employee performance report
        usersToFetch = usersToFetch.filter(u => u.role?.name?.toLowerCase() !== "client");

        const userIds = usersToFetch.map(u => u._id);

        // Time filtering for tasks (matched by assignedTo in userIds)
        const taskMatchQuery = { isDeleted: false, ...(allTime !== "true" ? { createdAt: { $gte: start, $lte: end } } : {}) };

        // Fetch Tasks Aggregation (Assigned vs Completed vs Late)
        const taskAgg = await Task.aggregate([
            { $match: taskMatchQuery },
            { $unwind: "$assignedTo" },
            { $match: { assignedTo: { $in: userIds } } },
            {
                $addFields: {
                    isLate: {
                        $cond: [
                            { $and: [ 
                                { $ne: [{ $type: "$dueDate" }, "missing"] },
                                { $ne: ["$dueDate", null] }, 
                                { $gt: ["$updatedAt", "$dueDate"] } 
                            ] },
                            1,
                            0
                        ]
                    },
                    weight: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$priority", "low"] }, then: 1 },
                                { case: { $eq: ["$priority", "medium"] }, then: 2 },
                                { case: { $eq: ["$priority", "high"] }, then: 3 },
                                { case: { $eq: ["$priority", "urgent"] }, then: 4 }
                            ],
                            default: 2
                        }
                    }
                }
            },
            { 
                $group: { 
                    _id: "$assignedTo", 
                    tasksAssigned: { $sum: 1 },
                    tasksCompleted: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
                    totalPoints: { $sum: "$weight" },
                    earnedPoints: { $sum: { $cond: [{ $eq: ["$status", "done"] }, "$weight", 0] } },
                    lateTasks: { $sum: { $cond: [ { $and: [{ $eq: ["$status", "done"] }, { $eq: ["$isLate", 1] }] }, 1, 0 ] } }
                } 
            }
        ]);

        // Fetch detailed task records for all employees in the period
        const periodTasks = await Task.find({
            ...taskMatchQuery,
            assignedTo: { $in: userIds }
        })
        .populate("project", "name")
        .select("title description status priority dueDate createdAt updatedAt assignedTo project")
        .sort({ createdAt: -1 })
        .lean();

        // Fetch Attendance Aggregation
        const attendanceAgg = await Attendance.aggregate([
            { $match: { ...attendanceMatch, userId: { $in: userIds } } },
            { 
                $group: {
                    _id: "$userId",
                    daysPresent: { $sum: { $cond: [{ $in: ["$status", ["present", "late", "half-day", "early-leave", "regularized"]] }, 1, 0] } },
                    daysLate: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
                    totalWorkingDays: { $sum: 1 }
                }
            }
        ]);

        // Merge Data
        const performanceMap = {};
        
        usersToFetch.forEach(u => {
            performanceMap[u._id.toString()] = {
                userId: u._id,
                name: `${u.firstName} ${u.lastName}`,
                profilePic: u.profilePic?.url || null,
                tasksAssigned: 0,
                tasksCompleted: 0,
                lateTasks: 0,
                taskCompletionRate: 0,
                daysPresent: 0,
                daysLate: 0,
                totalWorkingDays: 0,
                attendanceRate: 0,
                performanceScore: 0,
                tasks: []
            };
        });

        // Map detailed tasks to respective assignees
        periodTasks.forEach(task => {
            const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [task.assignedTo];
            assignees.forEach(assigneeId => {
                if (!assigneeId) return;
                const key = assigneeId.toString();
                if (performanceMap[key]) {
                    performanceMap[key].tasks.push({
                        _id: task._id,
                        title: task.title,
                        description: task.description || "",
                        projectName: task.project?.name || "General / No Project",
                        projectId: task.project?._id || null,
                        status: task.status,
                        priority: task.priority || "medium",
                        dueDate: task.dueDate,
                        createdAt: task.createdAt,
                        updatedAt: task.updatedAt
                    });
                }
            });
        });

        taskAgg.forEach(item => {
            const key = item._id.toString();
            if (performanceMap[key]) {
                performanceMap[key].tasksAssigned = item.tasksAssigned;
                performanceMap[key].tasksCompleted = item.tasksCompleted;
                performanceMap[key].lateTasks = item.lateTasks || 0;
                performanceMap[key].taskCompletionRate = item.totalPoints > 0 
                    ? Math.round((item.earnedPoints / item.totalPoints) * 100) 
                    : 0;
            }
        });

        attendanceAgg.forEach(item => {
            const key = item._id.toString();
            if (performanceMap[key]) {
                performanceMap[key].daysPresent = item.daysPresent;
                performanceMap[key].daysLate = item.daysLate;
                performanceMap[key].totalWorkingDays = item.totalWorkingDays;
                performanceMap[key].attendanceRate = item.totalWorkingDays > 0 
                    ? Math.round((item.daysPresent / item.totalWorkingDays) * 100) 
                    : 0;
            }
        });

        // Calculate Performance Score
        Object.values(performanceMap).forEach(dev => {
            let score = (dev.taskCompletionRate * 0.6) + (dev.attendanceRate * 0.4);
            let attendancePenalty = dev.daysLate * 2;
            let taskPenalty = dev.lateTasks * 5; // -5 points for every overdue task
            let penalty = attendancePenalty + taskPenalty;
            score = Math.max(0, score - penalty);
            dev.performanceScore = Math.round(score);

            // Calculate per-developer average completion time for completed tasks
            const devCompleted = (dev.tasks || []).filter(t => t.status === "done");
            if (devCompleted.length > 0) {
                const devTotalMs = devCompleted.reduce((s, t) => s + Math.max(0, new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()), 0);
                const devAvgMs = devTotalMs / devCompleted.length;
                const devAvgMins = Math.round(devAvgMs / 60000);
                const devAvgHrs = Math.round((devAvgMs / 3600000) * 10) / 10;
                dev.avgCompletionHours = devAvgHrs;
                dev.avgCompletionMinutes = devAvgMins;
                if (devAvgMs < 60000) {
                    dev.avgCompletionFormatted = "< 1 min";
                } else if (devAvgMins < 60) {
                    dev.avgCompletionFormatted = `${devAvgMins} min${devAvgMins > 1 ? "s" : ""}`;
                } else if (devAvgMs >= 86400000) {
                    const days = Math.floor(devAvgMs / 86400000);
                    const remHrs = Math.round((devAvgMs % 86400000) / 3600000);
                    dev.avgCompletionFormatted = remHrs > 0 ? `${days}d ${remHrs}h` : `${days} day${days > 1 ? "s" : ""}`;
                } else {
                    dev.avgCompletionFormatted = `${devAvgHrs} hrs`;
                }
            } else {
                dev.avgCompletionHours = 0;
                dev.avgCompletionMinutes = 0;
                dev.avgCompletionFormatted = "—";
            }
        });

        const sortedPerformance = Object.values(performanceMap)
            .sort((a, b) => b.performanceScore - a.performanceScore);

        // Calculate team summary
        const totalAssigned = sortedPerformance.reduce((s, d) => s + (d.tasksAssigned || 0), 0);
        const totalCompleted = sortedPerformance.reduce((s, d) => s + (d.tasksCompleted || 0), 0);
        const avgScore = sortedPerformance.length > 0
            ? Math.round(sortedPerformance.reduce((s, d) => s + (d.performanceScore || 0), 0) / sortedPerformance.length)
            : 0;
        const avgCompletionRate = totalAssigned > 0
            ? Math.round((totalCompleted / totalAssigned) * 100)
            : (sortedPerformance.length > 0 ? Math.round(sortedPerformance.reduce((s, d) => s + (d.taskCompletionRate || 0), 0) / sortedPerformance.length) : 0);

        // Calculate average completion time for completed tasks
        let completedTasks = await Task.find({
            status: "done",
            isDeleted: false,
            assignedTo: { $in: userIds },
            ...(allTime !== "true" ? { createdAt: { $gte: start, $lte: end } } : {})
        }).select("createdAt updatedAt");

        // Fallback: if period query returns 0 but user has completed tasks
        if (completedTasks.length === 0 && userIds.length > 0) {
            completedTasks = await Task.find({
                status: "done",
                isDeleted: false,
                assignedTo: { $in: userIds }
            }).select("createdAt updatedAt");
        }

        // Fallback: global completed tasks
        if (completedTasks.length === 0) {
            completedTasks = await Task.find({
                status: "done",
                isDeleted: false
            }).select("createdAt updatedAt");
        }

        let avgCompletionHours = 0;
        let avgCompletionMinutes = 0;
        let avgCompletionFormatted = "—";

        if (completedTasks.length > 0) {
            const totalMs = completedTasks.reduce((sum, t) => {
                const diffMs = Math.max(0, new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime());
                return sum + diffMs;
            }, 0);
            const avgMs = totalMs / completedTasks.length;
            avgCompletionMinutes = Math.round(avgMs / 60000);
            avgCompletionHours = Math.round((avgMs / 3600000) * 10) / 10;

            if (avgMs < 60000) {
                avgCompletionFormatted = "< 1 min";
            } else if (avgCompletionMinutes < 60) {
                avgCompletionFormatted = `${avgCompletionMinutes} min${avgCompletionMinutes > 1 ? "s" : ""}`;
            } else if (avgMs >= 86400000) {
                const days = Math.floor(avgMs / 86400000);
                const remHrs = Math.round((avgMs % 86400000) / 3600000);
                avgCompletionFormatted = remHrs > 0 ? `${days}d ${remHrs}h` : `${days} day${days > 1 ? "s" : ""}`;
            } else {
                avgCompletionFormatted = `${avgCompletionHours} hrs`;
            }
        }

        res.json({
            success: true,
            data: sortedPerformance,
            summary: {
                totalAssigned,
                totalCompleted,
                avgCompletionRate,
                avgScore,
                avgCompletionHours,
                avgCompletionMinutes,
                avgCompletionFormatted,
            },
            avgCompletionTime: avgCompletionHours,
            avgCompletionMinutes,
            avgCompletionFormatted,
            avgCompletionRate,
            avgScore
        });

    } catch (error) {
        console.error("PerformanceReport Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPerformanceHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const history = [];

        for (let i = 5; i >= 0; i--) {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
            const monthName = start.toLocaleString('en-US', { month: 'short' });

            const taskMatchQuery = { isDeleted: false, createdAt: { $gte: start, $lte: end } };
            const attendanceMatch = { 
                userId: new mongoose.Types.ObjectId(userId),
                date: { $gte: start.toISOString().split("T")[0], $lte: end.toISOString().split("T")[0] } 
            };

            const taskAgg = await Task.aggregate([
                { $match: taskMatchQuery },
                { $unwind: "$assignedTo" },
                { $match: { assignedTo: new mongoose.Types.ObjectId(userId) } },
                {
                    $addFields: {
                        isLate: {
                            $cond: [
                                { $and: [ 
                                    { $ne: [{ $type: "$dueDate" }, "missing"] },
                                    { $ne: ["$dueDate", null] }, 
                                    { $gt: ["$updatedAt", "$dueDate"] } 
                                ] }, 1, 0
                            ]
                        },
                        weight: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$priority", "low"] }, then: 1 },
                                    { case: { $eq: ["$priority", "medium"] }, then: 2 },
                                    { case: { $eq: ["$priority", "high"] }, then: 3 },
                                    { case: { $eq: ["$priority", "urgent"] }, then: 4 }
                                ],
                                default: 2
                            }
                        }
                    }
                },
                { 
                    $group: { 
                        _id: null,
                        totalPoints: { $sum: "$weight" },
                        earnedPoints: { $sum: { $cond: [{ $eq: ["$status", "done"] }, "$weight", 0] } },
                        lateTasks: { $sum: { $cond: [ { $and: [{ $eq: ["$status", "done"] }, { $eq: ["$isLate", 1] }] }, 1, 0 ] } }
                    } 
                }
            ]);

            const attendanceAgg = await Attendance.aggregate([
                { $match: attendanceMatch },
                { 
                    $group: {
                        _id: null,
                        daysPresent: { $sum: { $cond: [{ $in: ["$status", ["present", "late", "half-day", "early-leave", "regularized"]] }, 1, 0] } },
                        daysLate: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
                        totalWorkingDays: { $sum: 1 }
                    }
                }
            ]);

            let taskCompletionRate = 0;
            let lateTasks = 0;
            if (taskAgg.length > 0 && taskAgg[0].totalPoints > 0) {
                taskCompletionRate = Math.round((taskAgg[0].earnedPoints / taskAgg[0].totalPoints) * 100);
                lateTasks = taskAgg[0].lateTasks;
            }

            let attendanceRate = 0;
            let daysLate = 0;
            if (attendanceAgg.length > 0 && attendanceAgg[0].totalWorkingDays > 0) {
                attendanceRate = Math.round((attendanceAgg[0].daysPresent / attendanceAgg[0].totalWorkingDays) * 100);
                daysLate = attendanceAgg[0].daysLate;
            }

            let score = (taskCompletionRate * 0.6) + (attendanceRate * 0.4);
            let penalty = (daysLate * 2) + (lateTasks * 5);
            score = Math.max(0, Math.round(score - penalty));

            history.push({ month: monthName, score });
        }

        res.json({ success: true, data: history });

    } catch (error) {
        console.error("PerformanceHistory Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
