import cron from "node-cron";
import User from "../models/UserSchema.js";
import { createNotification } from "../utills/notificationHelper.js";

// Helper to reliably extract day, month (0-indexed), and year in IST (Asia/Kolkata)
const getISTDateParts = (dateInput) => {
    if (!dateInput) return null;
    let date;
    if (typeof dateInput === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
            const [y, m, d] = dateInput.split("-").map(Number);
            return { day: d, month: m - 1, year: y };
        }
        date = new Date(dateInput);
    } else {
        date = new Date(dateInput);
    }

    if (isNaN(date.getTime())) return null;

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "numeric",
        day: "numeric"
    });
    const parts = formatter.formatToParts(date);
    const day = parseInt(parts.find(p => p.type === "day").value, 10);
    const month = parseInt(parts.find(p => p.type === "month").value, 10) - 1; // 0-indexed
    const year = parseInt(parts.find(p => p.type === "year").value, 10);

    return { day, month, year };
};

const runWishesCron = async () => {
    try {
        console.log("Running automated Birthday & Anniversary Wishes cron job...");

        // Get current date parts in Asia/Kolkata timezone (IST)
        const todayParts = getISTDateParts(new Date());
        if (!todayParts) return;
        const { day: currentDay, month: currentMonth, year: currentYear } = todayParts;

        console.log(`[WishesCron] Evaluating for IST Date: Day ${currentDay}, Month ${currentMonth + 1}, Year ${currentYear}`);

        // Get all active users
        const users = await User.find({ isActive: true });

        for (const user of users) {
            // 1. Birthday Check (evaluated in IST)
            if (user.dateOfBirth) {
                const dobParts = getISTDateParts(user.dateOfBirth);
                if (dobParts && dobParts.day === currentDay && dobParts.month === currentMonth) {
                    // Send to the birthday person
                    await createNotification({
                        userId: user._id,
                        title: "Happy Birthday! 🎂",
                        message: `Wishing you a fantastic birthday, ${user.firstName}! Have a great year ahead.`,
                        type: "system",
                        link: "/profile"
                    });
                    
                    // Optionally notify others in the same company (Exclude the birthday person)
                    const colleagues = users.filter(u => 
                        u._id.toString() !== user._id.toString() && 
                        u.companyId?.toString() === user.companyId?.toString()
                    ).map(u => u._id);

                    if (colleagues.length > 0) {
                        await createNotification({
                            userId: colleagues,
                            title: "Birthday Alert! 🎉",
                            message: `Today is ${user.firstName} ${user.lastName}'s birthday! Wish them a great day.`,
                            type: "system",
                            link: "/users" // Or a generic page
                        });
                    }
                }
            }

            // 2. Work Anniversary Check (evaluated in IST)
            if (user.joiningDate) {
                const dojParts = getISTDateParts(user.joiningDate);
                // Check if month and day match, and they didn't join THIS year
                if (dojParts && dojParts.day === currentDay && dojParts.month === currentMonth && dojParts.year < currentYear) {
                    const yearsOfService = currentYear - dojParts.year;
                    const yearSuffix = yearsOfService === 1 ? 'year' : 'years';
                    
                    await createNotification({
                        userId: user._id,
                        title: "Happy Work Anniversary! 🎊",
                        message: `Congratulations on completing ${yearsOfService} ${yearSuffix} with us, ${user.firstName}! Thank you for your dedication.`,
                        type: "system",
                        link: "/profile"
                    });

                    // Notify others
                    const colleagues = users.filter(u => 
                        u._id.toString() !== user._id.toString() && 
                        u.companyId?.toString() === user.companyId?.toString()
                    ).map(u => u._id);

                    if (colleagues.length > 0) {
                        await createNotification({
                            userId: colleagues,
                            title: "Work Anniversary Alert! 🏆",
                            message: `Today marks ${user.firstName} ${user.lastName}'s ${yearsOfService} ${yearSuffix} work anniversary!`,
                            type: "system",
                            link: "/users"
                        });
                    }
                }
            }
        }

        console.log("Wishes Cron Job Completed.");
    } catch (error) {
        console.error("Error in Wishes Cron Job:", error);
    }
};

const startWishesCron = () => {
    // Run every day at 12:00 AM midnight Asia/Kolkata
    cron.schedule("0 0 * * *", runWishesCron, {
        timezone: "Asia/Kolkata"
    });
    console.log("Birthday & Anniversary Cron Job initialized. Scheduled for 12:00 AM daily (Asia/Kolkata).");
};

export { runWishesCron };
export default startWishesCron;
