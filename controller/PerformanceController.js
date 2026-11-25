import Task from "../models/TaskSchema.js";
import Attendance from "../models/AttendanceSchema.js";
import User from "../models/UserSchema.js";
import Project from "../models/ProjectSchema.js";
import mongoose from "mongoose";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";

const cid = (req) => req.user.company ? new mongoose.Types.ObjectId(req.user.company) : null;

const PRIORITY_WEIGHTS = {
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
};

const getIstMonthKey = (dateInput) => {
    const d = new Date(new Date(dateInput).getTime() + 5.5 * 3600000);
    return d.toISOString().slice(0, 7);
};

const getCurrentIstMonthKey = () => getIstMonthKey(Date.now());

const formatMonthLabel = (monthKey) => {
    const [y, m] = monthKey.split("-").map(Number);
    if (!y || !m) return monthKey;
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
};

const formatDurationStats = (tasks) => {
    if (!tasks || tasks.length === 0) {
        return { avgCompletionHours: 0, avgCompletionMinutes: 0, avgCompletionFormatted: "—" };
    }
    const totalMs = tasks.reduce((sum, t) => {
        const diffMs = Math.max(0, new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime());
        return sum + diffMs;
    }, 0);
    const avgMs = totalMs / tasks.length;
    const avgCompletionMinutes = Math.round(avgMs / 60000);
    const avgCompletionHours = Math.round((avgMs / 3600000) * 10) / 10;

    let avgCompletionFormatted;
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

    return { avgCompletionHours, avgCompletionMinutes, avgCompletionFormatted };
};

export const getPerformanceReport = async (req, res) => {
    try {
        const { startDate, endDate, month, year, allTime, userId: targetUserId } = req.query;
        const companyId = cid(req);
        const reqUser = req.user;

        if (targetUserId && !mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ success: false, message: "Invalid userId parameter" });
        }

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
        } else if (year && /^\d{4}$/.test(String(year))) {
            startStr = `${year}-01-01`;
            endStr = `${year}-12-31`;
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
            const curYear = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const lastDay = new Date(curYear, now.getMonth() + 1, 0).getDate();
            startStr = `${curYear}-${m}-01`;
            endStr = `${curYear}-${m}-${String(lastDay).padStart(2, "0")}`;
            start = new Date(`${startStr}T00:00:00.000+05:30`);
            end = new Date(`${endStr}T23:59:59.999+05:30`);
            attendanceMatch.date = { $gte: startStr, $lte: endStr };
        }

        let viewAll = isAdmin || (reqUser.permissions && reqUser.permissions.includes("VIEW_ALL_PERFORMANCE"));
        if (!viewAll && reqUser.userId) {
            const caller = await User.findById(reqUser.userId).select("role").populate("role", "name permissions").lean();
            if (caller?.role?.name === "super_admin" || caller?.role?.name === "admin" || caller?.role?.permissions?.includes("VIEW_ALL_PERFORMANCE")) {
                viewAll = true;
            }
        }
        
        let usersToFetch = [];
        if (reqUser.role === "super_admin") {
            // Super Admin sees everyone across all companies
            usersToFetch = await User.find({ isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName email employeeCode profilePic role");
        } else if (reqUser.role === "admin") {
            // Company Admin sees all active employees of their company
            usersToFetch = await User.find({ companyId: companyId, isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName email employeeCode profilePic role");
        } else if (viewAll) {
            // Manager/Lead with VIEW_ALL_PERFORMANCE: hierarchy filter — their subordinates
            const allowedIds = await getSubordinateIds(reqUser.userId);
            usersToFetch = await User.find({ _id: { $in: allowedIds }, isDeleted: false, isActive: true })
                .populate("role", "name")
                .select("_id firstName lastName email employeeCode profilePic role");
        } else {
            // Regular employee: only self
            const user = await User.findById(reqUser.userId)
                .populate("role", "name")
                .select("_id firstName lastName email employeeCode profilePic role");
            if (user) usersToFetch = [user];
        }

        // Exclude clients from employee performance report
        usersToFetch = usersToFetch.filter(u => u.role?.name?.toLowerCase() !== "client");

        if (targetUserId) {
            usersToFetch = usersToFetch.filter(u => String(u._id) === String(targetUserId));
            if (usersToFetch.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "Not authorized to view performance report for this employee"
                });
            }
        }

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
                name: `${u.firstName} ${u.lastName}`.trim(),
                email: u.email || "",
                employeeCode: u.employeeCode || "",
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
            Object.assign(dev, formatDurationStats(devCompleted));
        });

        const sortedPerformance = Object.values(performanceMap)
            .sort((a, b) => b.performanceScore - a.performanceScore);

        // Build month-by-month breakdown when viewing a single employee's report
        let monthlyBreakdown = [];
        if (targetUserId && sortedPerformance.length === 1) {
            const singleDev = sortedPerformance[0];
            const monthlyAttAgg = await Attendance.aggregate([
                { $match: { ...attendanceMatch, userId: userIds[0] } },
                {
                    $group: {
                        _id: { $substrCP: ["$date", 0, 7] },
                        daysPresent: { $sum: { $cond: [{ $in: ["$status", ["present", "late", "half-day", "early-leave", "regularized"]] }, 1, 0] } },
                        daysLate: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
                        totalWorkingDays: { $sum: 1 }
                    }
                }
            ]);

            const attByMonth = {};
            monthlyAttAgg.forEach(a => { if (a._id) attByMonth[a._id] = a; });

            const tasksByMonth = {};
            (singleDev.tasks || []).forEach(t => {
                const mk = getIstMonthKey(t.createdAt);
                if (!tasksByMonth[mk]) tasksByMonth[mk] = [];
                tasksByMonth[mk].push(t);
            });

            const monthSet = new Set([...Object.keys(attByMonth), ...Object.keys(tasksByMonth)]);
            if (allTime !== "true" && startStr && endStr) {
                const [sy, sm] = startStr.slice(0, 7).split("-").map(Number);
                const [ey, em] = endStr.slice(0, 7).split("-").map(Number);
                const curIstMonth = getCurrentIstMonthKey();
                let y = sy, m = sm;
                let guard = 0;
                while ((y < ey || (y === ey && m <= em)) && guard < 48) {
                    const mk = `${y}-${String(m).padStart(2, "0")}`;
                    // For full-year filter on the current year, omit future empty months
                    const isFutureEmptyYearMonth = year && mk > curIstMonth && !monthSet.has(mk);
                    if (!isFutureEmptyYearMonth) {
                        monthSet.add(mk);
                    }
                    m += 1;
                    if (m > 12) { m = 1; y += 1; }
                    guard += 1;
                }
            }

            monthlyBreakdown = Array.from(monthSet)
                .sort()
                .map(mk => {
                    const mTasks = tasksByMonth[mk] || [];
                    const mDone = mTasks.filter(t => t.status === "done");
                    let totalPoints = 0;
                    let earnedPoints = 0;
                    let lateTasksCount = 0;

                    mTasks.forEach(t => {
                        const weight = PRIORITY_WEIGHTS[t.priority] || 2;
                        totalPoints += weight;
                        if (t.status === "done") {
                            earnedPoints += weight;
                            if (t.dueDate && new Date(t.updatedAt) > new Date(t.dueDate)) {
                                lateTasksCount += 1;
                            }
                        }
                    });

                    const att = attByMonth[mk] || { daysPresent: 0, daysLate: 0, totalWorkingDays: 0 };
                    const taskCompletionRate = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
                    const attendanceRate = att.totalWorkingDays > 0 ? Math.round((att.daysPresent / att.totalWorkingDays) * 100) : 0;
                    const rawScore = (taskCompletionRate * 0.6) + (attendanceRate * 0.4) - (att.daysLate * 2) - (lateTasksCount * 5);
                    const performanceScore = Math.max(0, Math.round(rawScore));
                    const durationStats = formatDurationStats(mDone);

                    return {
                        month: mk,
                        monthLabel: formatMonthLabel(mk),
                        tasksAssigned: mTasks.length,
                        tasksCompleted: mDone.length,
                        lateTasks: lateTasksCount,
                        taskCompletionRate,
                        daysPresent: att.daysPresent,
                        daysLate: att.daysLate,
                        totalWorkingDays: att.totalWorkingDays,
                        attendanceRate,
                        performanceScore,
                        ...durationStats
                    };
                });
        }

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

        // Fallback when fetching team dashboard summary (skip for single-employee period queries)
        if (!targetUserId && completedTasks.length === 0 && userIds.length > 0) {
            completedTasks = await Task.find({
                status: "done",
                isDeleted: false,
                assignedTo: { $in: userIds }
            }).select("createdAt updatedAt");
        }

        if (!targetUserId && completedTasks.length === 0) {
            completedTasks = await Task.find({
                status: "done",
                isDeleted: false
            }).select("createdAt updatedAt");
        }

        const { avgCompletionHours, avgCompletionMinutes, avgCompletionFormatted } = formatDurationStats(completedTasks);

        res.json({
            success: true,
            data: sortedPerformance,
            monthlyBreakdown,
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
