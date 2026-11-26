import cron from "node-cron";
import User from "../models/UserSchema.js";
import Attendance from "../models/AttendanceSchema.js";
import Role from "../models/roleSchema.js";
import WorkShift from "../models/workShiftSchema.js";
import Holiday from "../models/HolidaySchema.js";
import LeaveApplication from "../models/LeaveApplicationSchema.js";

// Helper to get today's date in IST
const todayDate = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().split("T")[0];
};

export const runAbsentMarking = async () => {
    try {
        console.log("Running automated Absent Marking cron job...");

        // Get today's date in IST
        const date = todayDate();
        const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();

        // Exclude super admins and clients from absent marking
        const excludedRoles = await Role.find({ name: { $in: ["super_admin", "client"] } }).select("_id").lean();
        const excludedRoleIds = excludedRoles.map(r => r._id);

        // Get all active non-deleted users
        const filter = { isActive: true, isDeleted: { $ne: true } };
        if (excludedRoleIds.length > 0) {
            filter.role = { $nin: excludedRoleIds };
        }

        const activeUsers = await User.find(filter)
            .select("_id companyId workShift")
            .lean();

        const shiftCache = {};
        const holidayCache = {};
        let markedCount = 0;

        for (const user of activeUsers) {
            const companyId = user.companyId?.toString();

            // Check week-off for this user's shift
            let weekOff = [0, 6];
            if (user.workShift) {
                const shiftId = user.workShift.toString();
                if (!shiftCache[shiftId]) {
                    shiftCache[shiftId] = await WorkShift.findById(shiftId).select("weekOff").lean();
                }
                if (shiftCache[shiftId]?.weekOff?.length) {
                    weekOff = shiftCache[shiftId].weekOff;
                }
            }
            if (weekOff.includes(dayOfWeek)) continue;

            // Check company or global holiday
            const holidayKey = companyId || "__global__";
            if (!holidayCache[holidayKey]) {
                const holidayFilter = companyId
                    ? { date, $or: [{ companyId }, { companyId: null }, { companyId: { $exists: false } }] }
                    : { date, $or: [{ companyId: null }, { companyId: { $exists: false } }] };
                const holidays = await Holiday.find(holidayFilter).select("date").lean();
                holidayCache[holidayKey] = new Set(holidays.map(h => h.date));
            }
            if (holidayCache[holidayKey].has(date)) continue;

            // Skip if employee has an approved or pending leave covering today
            const onLeave = await LeaveApplication.findOne({
                userId: user._id,
                status: { $in: ["approved", "pending"] },
                fromDate: { $lte: date },
                toDate: { $gte: date },
            }).lean();
            if (onLeave) continue;

            // Check if an attendance record exists for this user today
            const existingRecord = await Attendance.findOne({ userId: user._id, date }).lean();

            if (!existingRecord) {
                // No record found, they never punched in. Mark as absent.
                await Attendance.create({
                    userId: user._id,
                    companyId: user.companyId,
                    workShiftId: user.workShift,
                    date,
                    status: "absent",
                    punches: [],
                    createdBy: user._id
                });
                markedCount++;
            }
        }

        console.log(`Cron Job Success: Marked ${markedCount} users as absent for ${date}.`);
        return markedCount;
    } catch (error) {
        console.error("Error in Attendance Cron Job:", error);
    }
};

const startAttendanceCron = () => {
    // Run every day at 8:00 PM IST (20:00 Asia/Kolkata)
    cron.schedule("0 20 * * *", runAbsentMarking, { timezone: "Asia/Kolkata" });
};

export default startAttendanceCron;
