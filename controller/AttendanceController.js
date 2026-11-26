import Attendance from "../models/AttendanceSchema.js";
import User from "../models/UserSchema.js";
import WorkShift from "../models/workShiftSchema.js";
import Role from "../models/roleSchema.js";
import Branch from "../models/BranchSchema.js";
import { createNotification } from "../utills/notificationHelper.js";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";
import { parseDeviceType } from "../utills/deviceHelper.js";
// hhhhh
const notifyAdmins = async (companyId, title, message) => {
    try {
        const roles = await Role.find({ name: { $in: ["super_admin", "admin"] } }).select("_id");
        const roleIds = roles.map(r => r._id);
        const filter = { role: { $in: roleIds }, isActive: true };
        if (companyId) filter.$or = [{ companyId }, { companyId: null }];
        const admins = await User.find(filter).select("_id");
        const adminIds = admins.map(a => a._id);
        
        if (adminIds.length > 0) {
            await createNotification({ userId: adminIds, title, message, type: "attendance", link: "/attendance" });
        }
    } catch (e) {
        console.error("Admin notification failed", e);
    }
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

// Helper to parse date/time string as IST (+05:30) and return Date object in UTC
export const parseDateTimeIST = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    let t = timeStr.trim();
    if (t.includes("Z") || /[+-]\d{2}/.test(t)) {
        return new Date(t.includes("T") ? t : `${dateStr}T${t}`);
    }
    if (t.length === 5) t += ":00";
    return new Date(`${dateStr}T${t}+05:30`);
};

export const parseISTDate = (str) => {
    if (!str) return null;
    let s = str.trim();
    if (s.includes("Z") || /[+-]\d{2}:\d{2}$/.test(s)) {
        return new Date(s);
    }
    if (s.includes("T")) {
        const [datePart, timePart] = s.split("T");
        let t = timePart || "";
        if (t.length === 5) t += ":00";
        return new Date(`${datePart}T${t}+05:30`);
    }
    return new Date(s);
};

// Always return today's date in IST
const todayDate = () => {
    const ist = new Date(Date.now() + IST_OFFSET_MS);
    return ist.toISOString().split("T")[0];
};

// Current time as IST Date object (for comparisons)
const nowIST = () => new Date(Date.now() + IST_OFFSET_MS);

// Convert "HH:MM" shift time string to a UTC Date representing that IST time today
const shiftTimeToDate = (timeStr) => {
    const [h, m] = timeStr.split(":").map(Number);
    const ist = nowIST();
    // Set hours/minutes in IST context, then convert back to UTC
    return new Date(Date.UTC(
        ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(),
        h, m, 0, 0
    ) - IST_OFFSET_MS);
};

// Determine status based on shift rules
const resolveCheckInStatus = (nowUtc, shift) => {
    if (!shift) {
        // fallback: late after 09:30 IST
        const fallback = shiftTimeToDate("09:30");
        return nowUtc > fallback ? "late" : "present";
    }
    const shiftStart = shiftTimeToDate(shift.startTime);
    const allowedUntil = new Date(shiftStart.getTime() + (shift.gracePeriod + shift.lateThreshold) * 60000);
    return nowUtc > allowedUntil ? "late" : "present";
};

const resolveCheckOutStatus = (nowUtc, shift, currentStatus) => {
    if (!shift) return currentStatus;
    const shiftEnd = shiftTimeToDate(shift.endTime);
    const earlyBefore = new Date(shiftEnd.getTime() - shift.earlyLeaveThreshold * 60000);
    if (nowUtc < earlyBefore) return "early-leave";
    return currentStatus;
};

// Haversine formula — distance in meters between two lat/lng points
const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// POST /api/attendance/checkin
export const checkIn = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { latitude, longitude, address, faceDescriptor } = req.body;

        const user = await User.findById(userId).select("companyId workShift attendanceSettings branch firstName lastName");
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        // ── Geofence check (Branch level) ──
        if (latitude && longitude) {
            const branch = user.branch ? await Branch.findById(user.branch) : null;
            if (branch?.isActive && branch?.location?.latitude) {
                const dist = haversineDistance(branch.location.latitude, branch.location.longitude, latitude, longitude);
                if (dist > branch.geofenceRadius) {
                    return res.status(403).json({
                        message: `You are ${Math.round(dist)}m away from ${branch.name}. Must be within ${branch.geofenceRadius}m.`,
                        success: false
                    });
                }
            }
        }

        // ── Face recognition check ──
        const geo = user.attendanceSettings;
        if (geo?.faceRecognitionEnabled) {
            if (!faceDescriptor || !Array.isArray(faceDescriptor))
                return res.status(400).json({ message: "Face scan required for check-in.", success: false });
            if (!geo.faceDescriptor || geo.faceDescriptor.length === 0)
                return res.status(400).json({ message: "No registered face found. Please contact admin.", success: false });

            // Euclidean distance between face descriptors
            const dist = Math.sqrt(geo.faceDescriptor.reduce((sum, v, i) => sum + (v - faceDescriptor[i]) ** 2, 0));
            if (dist > 0.5)
                return res.status(403).json({ message: "Face not recognized. Check-in denied.", success: false });
        }

        const date = todayDate();
        const existing = await Attendance.findOne({ userId, date });
        const shift = user.workShift ? await WorkShift.findById(user.workShift) : null;
        const now = new Date(); // UTC — stored in DB as UTC, displayed correctly via toLocaleTimeString

        // Detect device (Mobile vs Laptop/Tablet)
        const ua = req.headers["user-agent"] || "";
        const { deviceType, deviceDetails } = parseDeviceType(ua);

        const employeeName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Employee";

        if (existing) {
            // Allow re-check-in only if last punch has a checkout
            const lastPunch = existing.punches && existing.punches.length > 0 ? existing.punches[existing.punches.length - 1] : null;
            const hasOpenPunch = lastPunch && !lastPunch.checkOut;
            if (hasOpenPunch) return res.status(400).json({ message: "Already checked in. Please check out first.", success: false });

            // Ensure punches array exists
            if (!Array.isArray(existing.punches)) existing.punches = [];

            // If an auto-absent record (punches = [] or status = "absent") already existed for today, treat this as first real check-in
            const isFirstRealCheckIn = existing.punches.length === 0 || existing.status === "absent";
            const primaryCheckInForStatus = existing.punches[0]?.checkIn ? new Date(existing.punches[0].checkIn) : now;
            const resolvedStatus = resolveCheckInStatus(primaryCheckInForStatus, shift);

            // Add new punch with device info
            existing.punches.push({
                checkIn: now,
                checkInLocation: { latitude, longitude, address },
                deviceType,
                deviceDetails
            });
            existing.checkIn = existing.punches[0].checkIn; // keep first check-in as primary
            existing.checkOut = null; // open again
            existing.deviceType = deviceType;
            existing.deviceDetails = deviceDetails;
            if (!existing.checkInLocation?.latitude && (latitude != null || longitude != null || address)) {
                existing.checkInLocation = { latitude, longitude, address };
            }
            if (!existing.workShiftId && shift?._id) existing.workShiftId = shift._id;
            if (!existing.companyId && user.companyId) existing.companyId = user.companyId;
            if (isFirstRealCheckIn) existing.status = resolvedStatus;
            if (!existing.createdBy) existing.createdBy = userId;
            await existing.save();

            const populated = await Attendance.findById(existing._id)
                .populate("workShiftId", "name startTime endTime")
                .populate("createdBy", "firstName lastName");

            const checkInTime = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
            const selfMsg = isFirstRealCheckIn
                ? `You checked in at ${checkInTime}. Status: ${existing.status}.`
                : `You re-checked in at ${checkInTime}.`;
            const adminMsg = isFirstRealCheckIn
                ? `${employeeName} checked in at ${checkInTime}. Status: ${existing.status}.`
                : `${employeeName} re-checked in at ${checkInTime}.`;
            await createNotification({ userId, title: "Check-In Recorded", message: selfMsg, type: "attendance", link: "/attendance", createdBy: userId });
            await notifyAdmins(user.companyId, "User Checked In", adminMsg);
            return res.status(200).json({ message: isFirstRealCheckIn ? "Checked in successfully" : "Re-checked in successfully", attendance: populated, success: true });
        }

        const status = resolveCheckInStatus(now, shift);
        const attendance = await Attendance.create({
            userId,
            companyId: user.companyId,
            workShiftId: shift?._id || null,
            date,
            checkIn: now,
            checkInLocation: { latitude, longitude, address },
            deviceType,
            deviceDetails,
            punches: [{
                checkIn: now,
                checkInLocation: { latitude, longitude, address },
                deviceType,
                deviceDetails
            }],
            status,
            createdBy: userId,
        });

        const populated = await Attendance.findById(attendance._id)
            .populate("workShiftId", "name startTime endTime")
            .populate("createdBy", "firstName lastName");

        const checkInTime = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
        await createNotification({ userId, title: "Check-In Recorded", message: `You checked in at ${checkInTime}. Status: ${status}.`, type: "attendance", link: "/attendance", createdBy: userId });
        await notifyAdmins(user.companyId, "User Checked In", `${employeeName} checked in at ${checkInTime}. Status: ${status}.`);

        res.status(201).json({ message: "Checked in successfully", attendance: populated, success: true });
    } catch (error) {
        console.error("CHECK-IN ERROR:", error);
        res.status(500).json({ message: error.message || "Error checking in", success: false });
    }
};

// PATCH /api/attendance/checkout
export const checkOut = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { latitude, longitude, address } = req.body;

        const user = await User.findById(userId).select("companyId workShift branch firstName lastName");
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        const employeeName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Employee";

        // ── Geofence check (Branch level) ──
        if (user.branch) {
            const branch = await Branch.findById(user.branch);
            if (branch?.isActive && branch?.location?.latitude) {
                if (!latitude || !longitude) {
                    return res.status(400).json({
                        message: "Location is required to verify check-out within branch radius.",
                        success: false
                    });
                }
                const dist = haversineDistance(branch.location.latitude, branch.location.longitude, latitude, longitude);
                if (dist > branch.geofenceRadius) {
                    return res.status(403).json({
                        message: `You are ${Math.round(dist)}m away from ${branch.name}. Must be within ${branch.geofenceRadius}m to check out.`,
                        success: false
                    });
                }
            }
        }

        const date = todayDate();
        const attendance = await Attendance.findOne({ userId, date });
        if (!attendance) return res.status(404).json({ message: "No check-in found for today", success: false });

        // Ensure punches array exists
        if (!Array.isArray(attendance.punches)) attendance.punches = [];

        // Find the open punch (last punch without checkout)
        const lastPunch = attendance.punches[attendance.punches.length - 1];
        if (!lastPunch || lastPunch.checkOut) return res.status(400).json({ message: "No open check-in found. Please check in first.", success: false });

        const shift = attendance.workShiftId ? await WorkShift.findById(attendance.workShiftId) : null;
        const now = new Date();

        // Close the open punch
        const punchHours = parseFloat(((now - new Date(lastPunch.checkIn)) / 3600000).toFixed(2));
        lastPunch.checkOut = now;
        lastPunch.checkOutLocation = { latitude, longitude, address };
        lastPunch.workHours = punchHours;

        // Recalculate total work hours across all punches
        const totalWorkHours = parseFloat(attendance.punches.reduce((sum, p) => {
            if (p.checkIn && p.checkOut) return sum + (new Date(p.checkOut) - new Date(p.checkIn)) / 3600000;
            return sum;
        }, 0).toFixed(2));

        let status = attendance.status;
        if (status === "absent") {
            const primaryCheckIn = attendance.checkIn || attendance.punches?.[0]?.checkIn;
            status = primaryCheckIn ? resolveCheckInStatus(new Date(primaryCheckIn), shift) : "present";
        }
        const checkOutStatus = resolveCheckOutStatus(now, shift, status);
        if (totalWorkHours < 4) status = "half-day";
        else if (checkOutStatus === "early-leave") status = "early-leave";

        attendance.checkOut = now;
        attendance.checkOutLocation = { latitude, longitude, address };
        attendance.workHours = totalWorkHours;
        attendance.status = status;
        await attendance.save();

        const populated = await Attendance.findById(attendance._id)
            .populate("workShiftId", "name startTime endTime")
            .populate("createdBy", "firstName lastName");

        const checkOutTime = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
        await createNotification({ userId, title: "Check-Out Recorded", message: `You checked out at ${checkOutTime}. Total hours: ${totalWorkHours}h. Status: ${status}.`, type: "attendance", link: "/attendance", createdBy: userId });
        await notifyAdmins(user?.companyId || populated?.companyId, "User Checked Out", `${employeeName} checked out at ${checkOutTime}. Total hours: ${totalWorkHours}h.`);

        res.status(200).json({ message: "Checked out successfully", attendance: populated, success: true });
    } catch (error) {
        console.error("CHECK-OUT ERROR:", error);
        res.status(500).json({ message: error.message || "Error checking out", success: false });
    }
};

// GET /api/attendance/today
export const getTodayAttendance = async (req, res) => {
    try {
        const userId = req.user.userId;
        const record = await Attendance.findOne({ userId, date: todayDate() })
            .populate("workShiftId", "name startTime endTime")
            .populate("createdBy", "firstName lastName");
        res.status(200).json({ record: record || null, success: true });
    } catch (error) {
        res.status(500).json({ message: "Error fetching today attendance", success: false });
    }
};

// GET /api/attendance/my?month=2025-01
export const getMyAttendance = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { month } = req.query;
        const filter = { userId };
        if (month) filter.date = { $regex: `^${month}` };

        const records = await Attendance.find(filter)
            .populate("workShiftId", "name startTime endTime")
            .populate("createdBy", "firstName lastName")
            .sort({ date: -1 });

        res.status(200).json({ records, success: true });
    } catch (error) {
        res.status(500).json({ message: "Error fetching attendance", success: false });
    }
};

// GET /api/attendance/summary?month=2025-01&scope=team
export const getAttendanceSummary = async (req, res) => {
    try {
        const { month: qMonth, userId: qUserId, scope } = req.query;
        const month = qMonth || new Date().toISOString().slice(0, 7);

        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        const isSuperAdmin = reqUser?.role?.name === "super_admin" || req.user.role === "super_admin";
        const isAdmin = isSuperAdmin || reqUser?.role?.name === "admin" || req.user.role === "admin";

        let filter = { date: { $regex: `^${month}` } };

        if (qUserId) {
            if (isSuperAdmin || qUserId.toString() === req.user.userId.toString()) {
                filter.userId = qUserId;
            } else {
                const allowedIds = await getSubordinateIds(req.user.userId);
                const isAllowed = allowedIds.some(id => id.toString() === qUserId.toString());
                if (!isAllowed) {
                    return res.status(200).json({
                        summary: { present: 0, regularized: 0, late: 0, halfDay: 0, earlyLeave: 0, absent: 0, totalDays: 0, totalHours: 0, isTeam: false },
                        success: true
                    });
                }
                filter.userId = qUserId;
            }
        } else if (scope === "my") {
            filter.userId = req.user.userId;
        } else if (isAdmin || scope === "team") {
            if (isSuperAdmin) {
                // Super Admin sees all company team attendance
            } else {
                // Admin sees subordinates attendance
                const allowedIds = await getSubordinateIds(req.user.userId);
                filter.userId = { $in: allowedIds };
            }
        } else {
            filter.userId = req.user.userId;
        }

        const records = await Attendance.find(filter);

        const summary = {
            present:     records.filter(r => r.status === "present").length,
            regularized: records.filter(r => r.status === "regularized").length,
            late:        records.filter(r => r.status === "late").length,
            halfDay:     records.filter(r => r.status === "half-day").length,
            earlyLeave:  records.filter(r => r.status === "early-leave").length,
            absent:      records.filter(r => r.status === "absent").length,
            totalDays:   records.length,
            totalHours:  parseFloat(records.reduce((sum, r) => sum + (r.workHours || 0), 0).toFixed(2)),
            isTeam:      isAdmin && scope !== "my",
        };

        res.status(200).json({ summary, success: true });
    } catch (error) {
        console.error("Error fetching summary:", error);
        res.status(500).json({ message: "Error fetching summary", success: false });
    }
};

// PATCH /api/attendance/:id/manual-punch  (admin)
export const manualPunch = async (req, res) => {
    try {
        const { checkIn: ci, checkOut: co, status, note } = req.body;
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.status(404).json({ message: "Attendance record not found", success: false });

        if (status === "absent") {
            attendance.status = "absent";
            attendance.checkIn = null;
            attendance.checkOut = null;
            attendance.workHours = 0;
            attendance.punches = [];
        } else {
            if (ci) attendance.checkIn = parseISTDate(ci);
            if (co) attendance.checkOut = parseISTDate(co);
            if (status) attendance.status = status;
            if (note) attendance.note = note;

            if (attendance.checkIn && attendance.checkOut) {
                const diff = new Date(attendance.checkOut) - new Date(attendance.checkIn);
                attendance.workHours = parseFloat((diff / 3600000).toFixed(2));
            } else if (!attendance.checkIn) {
                attendance.workHours = 0;
            }

            if (attendance.punches && attendance.punches.length > 0) {
                if (attendance.checkIn) attendance.punches[0].checkIn = attendance.checkIn;
                if (attendance.checkOut) attendance.punches[0].checkOut = attendance.checkOut;
                if (attendance.workHours) attendance.punches[0].workHours = attendance.workHours;
            } else if (attendance.checkIn) {
                attendance.punches = [{ checkIn: attendance.checkIn, checkOut: attendance.checkOut || undefined, workHours: attendance.workHours || 0 }];
            }
        }

        if (!attendance.workShiftId) {
            const u = await User.findById(attendance.userId).select("workShift");
            if (u?.workShift) attendance.workShiftId = u.workShift;
        }

        attendance.isRegularized = true;
        attendance.updatedBy = req.user.userId;
        await attendance.save();

        await createNotification({ userId: attendance.userId, title: "Attendance Updated", message: `Your attendance for ${attendance.date} has been manually updated by admin.`, type: "attendance", link: "/attendance", createdBy: req.user.userId });
        res.status(200).json({ message: "Attendance updated", attendance, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// POST /api/attendance/admin-punch  (admin creates record for employee)
export const adminCreatePunch = async (req, res) => {
    try {
        const { userId, date, checkIn: ci, checkOut: co, status, note } = req.body;
        if (!userId || !date) return res.status(400).json({ message: "userId and date are required", success: false });

        const u = await User.findById(userId).select("companyId workShift");
        if (!u) return res.status(404).json({ message: "User not found", success: false });

        const existing = await Attendance.findOne({ userId, date });
        if (existing) return res.status(400).json({ message: "Attendance record already exists for this date. Use manual punch to update.", success: false });

        const checkInDate = parseDateTimeIST(date, ci);
        const checkOutDate = parseDateTimeIST(date, co);
        let workHours = 0;
        if (checkInDate && checkOutDate) {
            workHours = parseFloat(((checkOutDate - checkInDate) / 3600000).toFixed(2));
        }

        const attendance = await Attendance.create({
            userId, companyId: u.companyId, workShiftId: u.workShift || null,
            date, checkIn: checkInDate, checkOut: checkOutDate,
            punches: checkInDate ? [{ checkIn: checkInDate, checkOut: checkOutDate || undefined, workHours }] : [],
            workHours, status: status || "present", note,
            isRegularized: true, createdBy: req.user.userId, updatedBy: req.user.userId,
        });

        await createNotification({ userId, title: "Attendance Added", message: `Attendance for ${date} has been added by admin.`, type: "attendance", link: "/attendance", createdBy: req.user.userId });
        res.status(201).json({ message: "Attendance record created", attendance, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};
// GET /api/attendance/team  — manager sees their reporting hierarchy attendance (juniors & juniors' juniors)
export const getTeamAttendance = async (req, res) => {
    try {
        const { date, month, startDate, endDate, userId } = req.query;
        const allHierarchyIds = await getSubordinateIds(req.user.userId);
        const subordinateIds = allHierarchyIds.filter(id => id.toString() !== req.user.userId.toString());

        if (!subordinateIds.length) {
            return res.status(200).json({ records: [], hasTeam: false, success: true });
        }

        const subordinates = await User.find({
            _id: { $in: subordinateIds },
            isDeleted: { $ne: true }
        })
            .populate("role", "name")
            .select("_id role");

        // Exclude client role from subordinates
        const validReports = subordinates.filter(u => u.role?.name?.toLowerCase() !== "client");
        if (!validReports.length) {
            return res.status(200).json({ records: [], hasTeam: false, success: true });
        }

        const allowedIds = validReports.map(u => u._id);
        const filter = {};

        if (userId) {
            const isAllowedTarget = allowedIds.some(id => id.toString() === userId.toString());
            if (!isAllowedTarget) {
                return res.status(200).json({ records: [], hasTeam: true, success: true });
            }
            filter.userId = userId;
        } else {
            filter.userId = { $in: allowedIds };
        }

        if (startDate && endDate) {
            filter.date = { $gte: startDate, $lte: endDate };
        } else if (date) {
            filter.date = date;
        } else if (month) {
            filter.date = { $regex: `^${month}` };
        }

        const records = await Attendance.find(filter)
            .populate({
                path: "userId",
                select: "firstName lastName email employeeCode profilePic role",
                populate: { path: "role", select: "name" }
            })
            .populate("workShiftId", "name startTime endTime")
            .sort({ date: -1, checkIn: -1 });

        const filteredRecords = records.filter(r => r.userId && r.userId.role?.name?.toLowerCase() !== "client");

        res.status(200).json({ records: filteredRecords, hasTeam: true, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

export const getCompanyAttendance = async (req, res) => {
    try {
        const { date, month, userId, startDate, endDate } = req.query;
        const reqUser = await User.findById(req.user.userId).select("companyId role").populate("role", "name");
        if (!reqUser) return res.status(404).json({ message: "User not found", success: false });

        // Find all client roles across companies to exclude clients from attendance
        const clientRoles = await Role.find({ name: { $regex: /^client$/i } }).select("_id");
        let clientUserIds = [];
        if (clientRoles.length > 0) {
            const clients = await User.find({ role: { $in: clientRoles.map(r => r._id) } }).select("_id");
            clientUserIds = clients.map(c => c._id.toString());
        }

        const filter = {};

        if (reqUser.role?.name === "super_admin") {
            // Super Admin sees all attendance records (excluding clients)
            if (userId) {
                if (clientUserIds.includes(userId.toString())) {
                    return res.status(200).json({ records: [], success: true });
                }
                filter.userId = userId;
            } else if (clientUserIds.length > 0) {
                filter.userId = { $nin: clientUserIds };
            }
        } else {
            // Hierarchy filter: only see attendance of self + subordinates (juniors & juniors' juniors)
            const allowedIds = await getSubordinateIds(req.user.userId);
            const nonClientAllowedIds = allowedIds.filter(id => !clientUserIds.includes(id.toString()));

            if (userId) {
                const isAllowedTarget = nonClientAllowedIds.some(id => id.toString() === userId.toString());
                if (!isAllowedTarget) {
                    return res.status(200).json({ records: [], success: true });
                }
                filter.userId = userId;
            } else {
                filter.userId = { $in: nonClientAllowedIds };
            }
        }

        if (startDate && endDate) {
            filter.date = { $gte: startDate, $lte: endDate };
        } else if (date) {
            filter.date = date;
        } else if (month) {
            filter.date = { $regex: `^${month}` };
        }

        const records = await Attendance.find(filter)
            .populate({
                path: "userId",
                select: "firstName lastName email employeeCode profilePic role",
                populate: { path: "role", select: "name" }
            })
            .populate("companyId", "name")
            .populate("workShiftId", "name startTime endTime")
            .populate("createdBy", "firstName lastName")
            .sort({ date: -1, checkIn: -1 });

        const filteredRecords = records.filter(r => r.userId && r.userId.role?.name?.toLowerCase() !== "client");

        res.status(200).json({ records: filteredRecords, success: true });
    } catch (error) {
        console.error("COMPANY ATTENDANCE ERROR:", error);
        res.status(500).json({ message: "Error fetching company attendance", success: false });
    }
};

