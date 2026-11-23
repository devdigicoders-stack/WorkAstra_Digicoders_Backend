import User from "../models/UserSchema.js";
import Company from "../models/CompanySchema.js";
import { generateGreetingCard } from '../utills/cardGenerator.js';
import Role from "../models/roleSchema.js";
import Project from "../models/ProjectSchema.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cloudinary from "../utills/cloudinary.js";
import { sendMail } from "../utills/SendEmail.js";
import { genrateToken } from "../middleware/authMiddleware.js";
import { loginTemplate, userCreatedTemplate, resetPasswordOtpTemplate, resetPayrollPinOtpTemplate } from "../utills/emailTemplates/userTemplate.js";
import EnvData from "../config/EnvData.js";
import { createNotification } from "../utills/notificationHelper.js";
import { uploadToCloudinary } from "../middleware/multer.js";
import { getSubordinateIds } from "../utills/hierarchyHelper.js";
import { parseDeviceType } from "../utills/deviceHelper.js";

const normalizeDate = (date) => {
    if (!date) return null;
    return new Date(date).toISOString().split("T")[0];
};

export const registerUser = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password, role, companyId, gender, employeeCode, joiningDate, dateOfBirth, aadharDateOfBirth, department, designation, workShift, employmentStatus, reportingTo, address } = req.body;
        
        // Validate required fields
        const errors = [];
        if (!firstName?.trim()) errors.push("First name is required");
        if (!lastName?.trim()) errors.push("Last name is required");
        if (!email?.trim()) errors.push("Email is required");
        if (!password || password.length < 6) errors.push("Password must be at least 6 characters");
        if (!role) errors.push("Role is required");
        if (!companyId) errors.push("Company is required");
        
        if (errors.length > 0) {
            return res.status(400).json({ message: errors.join(", "), success: false, errors });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(409).json({ message: "Email already registered. Please use a different email or login.", success: false });
        }

        // Validate phone if provided
        if (phone && !/^[\d\s\-\+\(\)]+$/.test(phone)) {
            return res.status(400).json({ message: "Invalid phone number format", success: false });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.toLowerCase(),
            phone: phone?.trim() || null,
            password: hashedPassword,
            role,
            companyId,
            gender: gender || null,
            employeeCode: employeeCode?.trim() || null,
            joiningDate: joiningDate ? normalizeDate(joiningDate) : null,
            dateOfBirth: dateOfBirth ? normalizeDate(dateOfBirth) : null,
            aadharDateOfBirth: aadharDateOfBirth ? normalizeDate(aadharDateOfBirth) : null,
            department: department || null,
            designation: designation || null,
            workShift: workShift || null,
            employmentStatus: employmentStatus || null,
            reportingTo: reportingTo || null,
            address: address?.trim() || null,
            createdBy: req.user?.userId || null
        });
        
        if (req.file) {
            const finalProposal = await uploadToCloudinary(req.file, "digicoders/hrmsv2/proposals");
            user.finalProposal = { url: finalProposal.url, publicId: finalProposal.publicId };
        }
        
        await user.save();
        
        // Send welcome email asynchronously (don't block response)
        sendMail({ email, title: "Welcome to DigiCoders Workastra", msg: userCreatedTemplate(user, password) }).catch(err => console.error("Email send error:", err));
        
        // Create notification asynchronously
        createNotification({
            userId: user._id,
            title: "Welcome to DigiCoders Workastra! 🎉",
            message: `Hi ${firstName}, your account has been created. Start by checking your profile and attendance.`,
            type: "user",
            link: "/profile",
        }).catch(err => console.error("Notification error:", err));
        
        res.status(201).json({ message: "User registered successfully", success: true, userId: user._id });
    } catch (error) {
        console.error("User registration error:", error);
        
        // Handle specific MongoDB errors
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(409).json({ message: `${field} already exists. Please use a different value.`, success: false });
        }
        
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ message: messages.join(", "), success: false, errors: messages });
        }
        
        res.status(500).json({ message: "Failed to create user. Please try again later.", success: false });
    }
};

const generateOTP = () => Math.floor(100000 + Math.random() * 899999).toString();

export const getAllUsersByCompany = async (req, res) => {
    try {
        const { companyId } = req.params;
        const users = await User.find({ companyId }).select("-password -otp").populate("role", "name").populate("companyId", "name").populate("workShift", "name startTime endTime");
        const totalCount = await User.countDocuments({ companyId });
        res.status(200).json({ users, totalCount, success: true });
    } catch (error) {
        res.status(500).json({ message: "Error fetching users by company", success: false });
    }
};

export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: "Email and password are required", success: false });
        const user = await User.findOne({ email })
            .select("-otp -otpExpiry")
            .populate("role", "name permissions")
            .populate("companyId", "name")
            .populate("workShift", "name startTime endTime");
        if (!user) return res.status(400).json({ message: "Invalid credentials", success: false });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials", success: false });
        if (!user.isActive) return res.status(403).json({ message: "Your account has been disabled. Please contact your administrator.", success: false, blocked: true });
        

        if (user.role?.name !== "super_admin" && user.companyId) {
            const company = await Company.findById(user.companyId._id).select("status");
            if (!company || !company.status) return res.status(403).json({ message: "Your company account has been deactivated. Please contact support.", success: false, blocked: true });
        }

        // Track Login Device & Multi-Device Active Sessions
        let currentSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
        try {
            const ua = req.headers["user-agent"] || "";
            const rawIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip || "";
            const cleanIp = rawIp.replace("::ffff:", "").replace("::1", "127.0.0.1") || "127.0.0.1";
            const { deviceType, deviceDetails } = parseDeviceType(ua);

            user.lastLoginDevice = deviceType;
            user.lastLoginDeviceDetails = deviceDetails;
            user.lastLoginAt = new Date();

            const newSession = {
                sessionId: currentSessionId,
                deviceType,
                deviceDetails,
                ip: cleanIp,
                loginAt: new Date(),
                lastActiveAt: new Date(),
                isActive: true
            };

            const existingSessions = (user.loggedDevices || []).filter(s => s && s.isActive && s.sessionId !== currentSessionId);
            user.loggedDevices = [
                newSession,
                ...existingSessions
            ].slice(0, 10);

            await user.save();
        } catch (deviceErr) {
            console.error("Error saving login device info:", deviceErr);
        }

        const token = genrateToken({ 
            userId: user._id, 
            role: user.role.name, 
            company: user?.companyId?._id, 
            permissions: user.role.permissions || [],
            sessionId: currentSessionId
        });
        user.password = undefined;
        const isProd = EnvData.NODE_ENV === "production";
        res.cookie("token", token, {
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            maxAge: 24 * 60 * 60 * 1000,
        }).status(200).json({ user, message: "Login successful", success: true });
        sendMail({ email, title: "Login Successful", msg: loginTemplate(user.firstName) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error logging in", success: false });
    }
};

// POST /api/user/forgot-password  — send OTP to email for password reset
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required", success: false });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "No account found with this email", success: false });
        const otp = generateOTP();
        user.otp = otp;
        user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
        await user.save();
        sendMail({ email, title: "Password Reset OTP", msg: resetPasswordOtpTemplate(user.firstName, otp) });
        console.log(`Reset OTP for ${email}: ${otp}`);
        res.status(200).json({ message: "OTP sent to your email", success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error sending OTP", success: false });
    }
};

// POST /api/user/reset-password  — verify OTP and set new password
export const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) return res.status(400).json({ message: "Email, OTP and new password are required", success: false });
        if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters", success: false });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        if (!user.otp || user.otp !== otp) return res.status(400).json({ message: "Invalid OTP", success: false });
        if (user.otpExpiry < new Date()) return res.status(400).json({ message: "OTP has expired. Please request a new one.", success: false });
        user.password = await bcrypt.hash(newPassword, 10);
        user.otp = null;
        user.otpExpiry = null;
        await user.save();
        res.status(200).json({ message: "Password reset successfully. You can now log in.", success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error resetting password", success: false });
    }
};

// PATCH /api/user/:id/change-password  — admin changes any user's password
export const adminChangePassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6)
            return res.status(400).json({ message: "New password must be at least 6 characters", success: false });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        user.password = await bcrypt.hash(newPassword, 10);
        user.updatedBy = req.user.userId;
        await user.save();
        await createNotification({
            userId: user._id,
            title: "Password Changed by Admin",
            message: "Your password has been changed by an administrator. Please log in with your new password.",
            type: "user", link: "/profile", createdBy: req.user.userId,
        });
        res.status(200).json({ message: "Password changed successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message || "Error changing password", success: false });
    }
};

export const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .select("-password -otp")
            .populate("role", "name permissions")
            .populate("companyId", "name")
            .populate("workShift", "name startTime endTime")
            .populate("employmentStatus", "name")
            .populate("reportingTo", "firstName lastName employeeCode profilePic")
            .populate("department", "name");
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        res.status(200).json({ user, success: true });
    } catch (error) {
        res.status(500).json({ message: "Error fetching user profile", success: false });
    }
};

export const getAllUsers = async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.userId).select("role companyId").populate("role", "name");
        if (!currentUser) return res.status(404).json({ message: "User not found", success: false });

        // Super Admin — no filter, sees everyone
        if (currentUser?.role?.name === "super_admin") {
            const users = await User.find().select("-password -otp")
                .populate("role", "name").populate("companyId", "name")
                .populate("department", "name")
                .populate("workShift", "name startTime endTime")
                .populate("employmentStatus", "name")
                .populate("reportingTo", "firstName lastName employeeCode profilePic")
                .populate("createdBy", "firstName lastName")
                .populate("updatedBy", "firstName lastName");
            return res.status(200).json({ users, totalCount: users.length, success: true });
        }

        // All other roles — Hierarchy filter:
        // Only see self + direct/indirect subordinates (children, grandchildren...)
        // Admin B1 will NOT see Admin B2's data even if both are in same company
        const allowedIds = await getSubordinateIds(req.user.userId);

        const users = await User.find({ _id: { $in: allowedIds } }).select("-password -otp")
            .populate("role", "name").populate("companyId", "name")
            .populate("department", "name")
            .populate("workShift", "name startTime endTime")
            .populate("employmentStatus", "name")
            .populate("reportingTo", "firstName lastName employeeCode profilePic")
            .populate("createdBy", "firstName lastName")
            .populate("updatedBy", "firstName lastName");
        return res.status(200).json({ users, totalCount: users.length, success: true });
    } catch (error) {
        console.error("GET USERS ERROR:", error);
        res.status(500).json({ message: "Error fetching users", success: false });
    }
};

export const updateUserProfile = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password, gender, employeeCode, joiningDate, dateOfBirth, aadharDateOfBirth, department, designation, workShift, employmentStatus, reportingTo, address } = req.body;
        const profilePic = req.file ? await uploadToCloudinary(req.file, "digicoders/hrmsv2/profiles") : null;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        if (email !== undefined) {
            const cleanEmail = email.toLowerCase().trim();
            if (!cleanEmail) {
                return res.status(400).json({ message: "Email is required", success: false });
            }
            if (cleanEmail !== user.email) {
                const existing = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
                if (existing) return res.status(409).json({ message: "Email is already registered with another account.", success: false });
                user.email = cleanEmail;
            }
        }

        if (firstName !== undefined) user.firstName = firstName.trim();
        if (lastName !== undefined) user.lastName = lastName.trim();
        if (phone !== undefined) user.phone = phone ? phone.trim() : null;
        if (address !== undefined) user.address = address ? address.trim() : null;
        if (gender !== undefined) user.gender = gender || null;
        if (employeeCode !== undefined) user.employeeCode = employeeCode ? employeeCode.trim() : null;
        if (joiningDate !== undefined) user.joiningDate = normalizeDate(joiningDate);
        if (dateOfBirth !== undefined) user.dateOfBirth = normalizeDate(dateOfBirth);
        if (aadharDateOfBirth !== undefined) user.aadharDateOfBirth = normalizeDate(aadharDateOfBirth);
        if (department !== undefined) user.department = department || null;
        if (designation !== undefined) user.designation = designation || null;
        if (workShift !== undefined) user.workShift = workShift || null;
        if (employmentStatus !== undefined) user.employmentStatus = employmentStatus || null;
        if (reportingTo !== undefined) user.reportingTo = reportingTo || null;
        if (password) user.password = await bcrypt.hash(password, 10);
        if (profilePic) {
            if (user.profilePic?.publicId) await cloudinary.uploader.destroy(user.profilePic.publicId, { resource_type: "image" }).catch(() => {});
            user.profilePic = { url: profilePic.url, publicId: profilePic.publicId };
        }
        await user.save();
        // Send notification before response so any error is caught
        await createNotification({
            userId: req.user.userId,
            title: "Profile Updated",
            message: "Your profile information has been updated successfully.",
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });
        res.status(200).json({ message: "Profile updated successfully", success: true });
    } catch (error) {
        console.error("UPDATE PROFILE ERROR:", error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "Field";
            return res.status(409).json({ message: `${field} already exists. Please use a different value.`, success: false });
        }
        res.status(500).json({ message: error.message || "Error updating profile", success: false });
    }
};

export const adminUpdateUser = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, role, gender, employeeCode, joiningDate, dateOfBirth, aadharDateOfBirth, companyId, workShift, reportingTo, employmentStatus, department, designation, address } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        if (email !== undefined) {
            const cleanEmail = email.toLowerCase().trim();
            if (!cleanEmail) {
                return res.status(400).json({ message: "Email is required", success: false });
            }
            if (cleanEmail !== user.email) {
                const existing = await User.findOne({ email: cleanEmail, _id: { $ne: user._id } });
                if (existing) return res.status(409).json({ message: "Email is already registered with another account.", success: false });
                user.email = cleanEmail;
            }
        }

        if (firstName !== undefined) user.firstName = firstName.trim();
        if (lastName !== undefined) user.lastName = lastName.trim();
        if (phone !== undefined) user.phone = phone ? phone.trim() : null;
        if (address !== undefined) user.address = address ? address.trim() : null;
        if (role) user.role = role;
        if (gender !== undefined) user.gender = gender || null;
        if (employeeCode !== undefined) user.employeeCode = employeeCode ? employeeCode.trim() : null;
        if (companyId) user.companyId = companyId;
        if (workShift !== undefined) user.workShift = workShift || null;
        if (employmentStatus !== undefined) user.employmentStatus = employmentStatus || null;
        if (department !== undefined) user.department = department || null;
        if (designation !== undefined) user.designation = designation || null;
        if (reportingTo !== undefined) user.reportingTo = reportingTo || null;
        if (joiningDate !== undefined) user.joiningDate = normalizeDate(joiningDate);
        if (dateOfBirth !== undefined) user.dateOfBirth = normalizeDate(dateOfBirth);
        if (aadharDateOfBirth !== undefined) user.aadharDateOfBirth = normalizeDate(aadharDateOfBirth);
        if (req.body.attendanceSettings !== undefined) {
            const as = typeof req.body.attendanceSettings === "string"
                ? JSON.parse(req.body.attendanceSettings)
                : req.body.attendanceSettings;
            user.attendanceSettings = { ...user.attendanceSettings, ...as };
        }
        if (req.body.branch !== undefined) user.branch = req.body.branch || null;
        
        if (req.file) {
            const finalProposal = await uploadToCloudinary(req.file, "digicoders/hrmsv2/proposals");
            if (user.finalProposal?.publicId) {
                await cloudinary.uploader.destroy(user.finalProposal.publicId, { resource_type: "raw" }).catch(() => {});
            }
            user.finalProposal = { url: finalProposal.url, publicId: finalProposal.publicId };
        }

        user.updatedBy = req.user.userId;
        await user.save();
        res.status(200).json({ message: "User updated successfully", success: true });
        await createNotification({
            userId: user._id,
            title: "Your Profile Was Updated",
            message: "An administrator has updated your account details.",
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });
    } catch (error) {
        console.error("ADMIN UPDATE USER ERROR:", error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "Field";
            return res.status(409).json({ message: `${field} already exists. Please use a different value.`, success: false });
        }
        res.status(500).json({ message: error.message || "Error updating user", success: false });
    }
};

export const verifyToken = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .select("-password -otp")
            .populate("role", "name permissions")
            .populate("companyId", "name status")
            .populate("workShift", "name startTime endTime")
            .populate("employmentStatus", "name")
            .populate("reportingTo", "firstName lastName employeeCode profilePic");
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        if (!user.isActive) return res.status(403).json({ message: "Your account has been disabled.", success: false, blocked: true });
        if (user.role?.name !== "super_admin" && user.companyId && !user.companyId.status)
            return res.status(403).json({ message: "Your company account has been deactivated.", success: false, blocked: true });
        res.status(200).json({ user, success: true });
    } catch (error) {
        res.status(500).json({ message: "Error verifying token", success: false });
    }
};

export const toggleUserStatus = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        if (user._id.toString() === req.user.userId) return res.status(400).json({ message: "Cannot disable your own account", success: false });
        user.isActive = !user.isActive;
        user.updatedBy = req.user.userId;
        await user.save();
        await createNotification({
            userId: user._id,
            title: user.isActive ? "Account Activated" : "Account Disabled",
            message: user.isActive
                ? "Your account has been activated. You can now log in."
                : "Your account has been disabled by an administrator. Contact your admin for access.",
            type: "user",
            link: "/",
            createdBy: req.user.userId,
        });
        res.status(200).json({ message: `User ${user.isActive ? "activated" : "disabled"} successfully`, isActive: user.isActive, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message || "Error toggling user status", success: false });
    }
};

export const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword)
            return res.status(400).json({ message: "Current and new password are required", success: false });
        if (newPassword.length < 6)
            return res.status(400).json({ message: "New password must be at least 6 characters", success: false });

        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Current password is incorrect", success: false });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        await createNotification({
            userId: user._id,
            title: "Password Changed",
            message: "Your password was changed successfully. If this wasn't you, contact your administrator.",
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });

        res.status(200).json({ message: "Password changed successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message || "Error changing password", success: false });
    }
};

export const logoutUser = async (req, res) => {
    try {
        const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.startsWith("Bearer") ? req.headers.authorization.split(" ")[1] : null);
        if (token) {
            try {
                const decoded = jwt.verify(token, EnvData.JWT_SECRET);
                if (decoded?.userId && decoded?.sessionId) {
                    await User.findByIdAndUpdate(decoded.userId, {
                        $pull: { loggedDevices: { sessionId: decoded.sessionId } }
                    });
                }
            } catch (tokenErr) {
                // Ignore token error on logout
            }
        }
        const isProd = EnvData.NODE_ENV === "production";
        res.clearCookie("token", { httpOnly: true, secure: isProd, sameSite: isProd ? "none" : "lax" });
        return res.status(200).json({ message: "Logged out successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: "Error logging out", success: false });
    }
};

// Terminate a specific device session (Self or Admin)
export const terminateDeviceSession = async (req, res) => {
    try {
        const { userId, sessionId } = req.body;
        const targetUserId = userId || req.user.userId;

        // Check permission: user can terminate own session, admin/super_admin can terminate any user's session
        if (targetUserId.toString() !== req.user.userId.toString() && req.user.role !== "admin" && req.user.role !== "super_admin") {
            return res.status(403).json({ message: "Not authorized to terminate this session", success: false });
        }

        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        if (sessionId === "ALL") {
            user.loggedDevices = [];
        } else {
            user.loggedDevices = (user.loggedDevices || []).filter(s => 
                s.sessionId !== sessionId && s._id?.toString() !== sessionId
            );
        }
        await user.save({ validateModifiedOnly: true });

        return res.status(200).json({ 
            message: sessionId === "ALL" ? "All device sessions logged out successfully" : "Device session logged out successfully", 
            success: true, 
            loggedDevices: user.loggedDevices 
        });
    } catch (error) {
        console.error("Terminate session error:", error);
        return res.status(500).json({ message: "Error terminating device session", success: false });
    }
};


export const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found', success: false });
        if (user._id.toString() === req.user.userId) return res.status(400).json({ message: 'Cannot delete your own account', success: false });
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'User deleted successfully', success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting user', success: false });
    }
};

export const saveFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "Token is required", success: false });
        
        await User.findByIdAndUpdate(req.user.userId, { fcmToken });
        res.status(200).json({ message: "Token saved successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: "Error saving token", success: false });
    }
};

export const getUpcomingEvents = async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.userId).populate("role");
        if (!currentUser) {
            return res.status(404).json({ message: "User not found", success: false });
        }
        
        const companyId = currentUser.role?.name === "super_admin" ? null : currentUser.companyId;

        const query = { isActive: true };
        if (companyId) query.companyId = companyId;

        const users = await User.find(query).select("firstName lastName profilePic dateOfBirth joiningDate");

        const istFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "numeric",
            day: "numeric"
        });
        const getISTParts = (dInput) => {
            if (!dInput) return null;
            let d;
            if (typeof dInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dInput)) {
                d = new Date(dInput + "T00:00:00+05:30");
            } else {
                d = new Date(dInput);
            }
            if (isNaN(d.getTime())) return null;
            const p = istFormatter.formatToParts(d);
            return {
                day: parseInt(p.find(x => x.type === "day").value, 10),
                month: parseInt(p.find(x => x.type === "month").value, 10) - 1,
                year: parseInt(p.find(x => x.type === "year").value, 10)
            };
        };

        const todayParts = getISTParts(new Date());
        const todayNoTime = new Date(todayParts.year, todayParts.month, todayParts.day);
        const thirtyDaysFromNow = new Date(todayNoTime);
        thirtyDaysFromNow.setDate(todayNoTime.getDate() + 30);

        const upcomingBirthdays = [];
        const upcomingAnniversaries = [];

        users.forEach(user => {
            // Check Birthday in IST
            if (user.dateOfBirth) {
                const dobParts = getISTParts(user.dateOfBirth);
                if (dobParts) {
                    const nextBirthday = new Date(todayParts.year, dobParts.month, dobParts.day);
                    
                    if (nextBirthday < todayNoTime) {
                        nextBirthday.setFullYear(todayParts.year + 1);
                    }

                    if (nextBirthday >= todayNoTime && nextBirthday <= thirtyDaysFromNow) {
                        upcomingBirthdays.push({
                            user: { _id: user._id, firstName: user.firstName, lastName: user.lastName, profilePic: user.profilePic },
                            date: nextBirthday,
                            type: "Birthday"
                        });
                    }
                }
            }

            // Check Anniversary in IST
            if (user.joiningDate) {
                const dojParts = getISTParts(user.joiningDate);
                if (dojParts && dojParts.year < todayParts.year) {
                    const nextAnniversary = new Date(todayParts.year, dojParts.month, dojParts.day);
                    
                    if (nextAnniversary < todayNoTime) {
                        nextAnniversary.setFullYear(todayParts.year + 1);
                    }

                    if (nextAnniversary >= todayNoTime && nextAnniversary <= thirtyDaysFromNow) {
                        const years = nextAnniversary.getFullYear() - dojParts.year;
                        upcomingAnniversaries.push({
                            user: { _id: user._id, firstName: user.firstName, lastName: user.lastName, profilePic: user.profilePic },
                            date: nextAnniversary,
                            years: years,
                            type: "Anniversary"
                        });
                    }
                }
            }
        });

        upcomingBirthdays.sort((a, b) => a.date - b.date);
        upcomingAnniversaries.sort((a, b) => a.date - b.date);

        res.status(200).json({ upcomingBirthdays, upcomingAnniversaries, success: true });
    } catch (error) {
        console.error("GET UPCOMING EVENTS ERROR:", error);
        res.status(500).json({ message: "Error fetching upcoming events", success: false });
    }
};

export const getAllClients = async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.userId).populate("role", "name");
        if (!currentUser) return res.status(404).json({ message: "User not found", success: false });

        const clientRoles = await Role.find({ name: { $regex: /^client$/i } });
        if (!clientRoles || clientRoles.length === 0) return res.status(200).json({ users: [], totalCount: 0, success: true });
        
        const clientRoleIds = clientRoles.map(r => r._id);

        let clientIdsToFetch = [];

        if (currentUser.role?.name === "super_admin") {
            // Super Admin sees all clients
            const clients = await User.find({ role: { $in: clientRoleIds } }).select("-password -otp")
                .populate("role", "name").populate("companyId", "name");
            return res.status(200).json({ users: clients, totalCount: clients.length, success: true });
        } else if (currentUser.role?.name?.toLowerCase() === "admin") {
            // Admin sees all clients in their company
            const clients = await User.find({ companyId: currentUser.companyId, role: { $in: clientRoleIds } }).select("-password -otp")
                .populate("role", "name").populate("companyId", "name");
            return res.status(200).json({ users: clients, totalCount: clients.length, success: true });
        } else {
            // Employees/Managers only see clients associated with their projects
            const projects = await Project.find({
                $or: [
                    { createdBy: req.user.userId },
                    { members: req.user.userId }
                ],
                isDeleted: false
            });

            projects.forEach(p => {
                if (p.clientIds && p.clientIds.length > 0) {
                    clientIdsToFetch.push(...p.clientIds.map(id => id.toString()));
                }
            });

            // unique client ids
            clientIdsToFetch = [...new Set(clientIdsToFetch)];

            const clients = await User.find({ 
                _id: { $in: clientIdsToFetch },
                role: { $in: clientRoleIds } 
            }).select("-password -otp").populate("role", "name").populate("companyId", "name");

            return res.status(200).json({ users: clients, totalCount: clients.length, success: true });
        }
    } catch (error) {
        console.error("GET ALL CLIENTS ERROR:", error);
        res.status(500).json({ message: "Error fetching clients", success: false });
    }
};

export const getGreetingCardUrl = async (req, res) => {
    try {
        const { type } = req.query; // 'birthday' or 'anniversary'
        const currentUser = await User.findById(req.user.userId);
        if (!currentUser) return res.status(404).json({ message: "User not found", success: false });
        
        const cardUrl = await generateGreetingCard(currentUser, type || 'birthday');
        
        if (cardUrl) {
            res.status(200).json({ url: cardUrl, success: true });
        } else {
            res.status(500).json({ message: "Failed to generate card", success: false });
        }
    } catch (error) {
        console.error("GET GREETING CARD ERROR:", error);
        res.status(500).json({ message: "Error fetching greeting card", success: false });
    }
};

// ─── Bank & UPI Details ────────────────────────────────────────────────────────

// PUT /api/user/bank-details — Employee submits/updates bank details (only if not approved)
export const submitBankDetails = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        // Block editing if already approved
        if (user.bankStatus === "approved") {
            return res.status(403).json({ message: "Bank details are already approved and cannot be changed.", success: false });
        }

        const {
            accountHolderName, accountNumber, ifscCode, accountType, branch,
            upiId, upiName, upiNumber, upiType
        } = req.body;

        // Handle QR Code upload if provided
        let qrCode = user.bankDetails?.qrCode || {};
        if (req.file) {
            // Delete old QR from Cloudinary if exists
            if (qrCode.publicId) {
                await cloudinary.uploader.destroy(qrCode.publicId, { resource_type: "image" }).catch(() => {});
            }
            const uploaded = await uploadToCloudinary(req.file, "digicoders/hrmsv2/bank-qr");
            qrCode = { url: uploaded.url, publicId: uploaded.publicId };
        }

        user.bankDetails = {
            accountHolderName: accountHolderName || user.bankDetails?.accountHolderName,
            accountNumber: accountNumber || user.bankDetails?.accountNumber,
            ifscCode: ifscCode || user.bankDetails?.ifscCode,
            accountType: accountType || user.bankDetails?.accountType,
            branch: branch || user.bankDetails?.branch,
            upiId: upiId || user.bankDetails?.upiId,
            upiName: upiName || user.bankDetails?.upiName,
            upiNumber: upiNumber || user.bankDetails?.upiNumber,
            upiType: upiType || user.bankDetails?.upiType,
            qrCode,
        };
        user.bankStatus = "pending";
        user.bankRejectedReason = null;
        await user.save();

        // Notify Admins
        const adminRole = await Role.findOne({ name: { $in: ["super_admin", "admin"] } });
        if (adminRole) {
            const admins = await User.find({ role: adminRole._id, isActive: true, companyId: user.companyId }).select("_id");
            const adminIds = admins.map(a => a._id);
            if (adminIds.length > 0) {
                await createNotification({
                    userId: adminIds,
                    title: "Bank Details Submitted",
                    message: `${user.firstName} ${user.lastName} ne apne bank details submit kiye hain. Please review karein.`,
                    type: "user",
                    link: `/employees/${user._id}`,
                    createdBy: req.user.userId,
                });
            }
        }

        res.json({ message: "Bank details submitted for approval", success: true });
    } catch (error) {
        console.error("SUBMIT BANK DETAILS ERROR:", error);
        res.status(500).json({ message: error.message, success: false });
    }
};

// GET /api/user/bank-details — Employee sees own bank details
export const getMyBankDetails = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select("bankDetails bankStatus bankRejectedReason firstName lastName");
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        res.json({ bankDetails: user.bankDetails, bankStatus: user.bankStatus, bankRejectedReason: user.bankRejectedReason, success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// PATCH /api/user/:id/bank-details/approve — Admin approves
export const approveBankDetails = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        if (user.bankStatus !== "pending") {
            return res.status(400).json({ message: "No pending bank details to approve", success: false });
        }
        user.bankStatus = "approved";
        user.bankRejectedReason = null;
        await user.save();

        await createNotification({
            userId: user._id,
            title: "Bank Details Approved ✅",
            message: "Aapke bank details admin ne approve kar diye hain.",
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });

        res.json({ message: "Bank details approved successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// PATCH /api/user/:id/bank-details/reject — Admin rejects
export const rejectBankDetails = async (req, res) => {
    try {
        const { reason } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        user.bankStatus = "rejected";
        user.bankRejectedReason = reason || "Admin ne reject kiya";
        await user.save();

        await createNotification({
            userId: user._id,
            title: "Bank Details Rejected ❌",
            message: `Aapke bank details reject ho gaye. Reason: ${user.bankRejectedReason}`,
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });

        res.json({ message: "Bank details rejected", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// PUT /api/user/:id/bank-details/admin-edit — Admin directly edits bank details
export const adminEditBankDetails = async (req, res) => {
    try {
        const { accountHolderName, accountNumber, ifscCode, accountType, branch, upiId, upiName, upiNumber, upiType } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        let qrCode = user.bankDetails?.qrCode || {};
        if (req.file) {
            const uploaded = await uploadToCloudinary(req.file, "digicoders/hrmsv2/bank-qr");
            qrCode = { url: uploaded.url, publicId: uploaded.publicId };
        }

        user.bankDetails = {
            accountHolderName: accountHolderName || user.bankDetails?.accountHolderName,
            accountNumber: accountNumber || user.bankDetails?.accountNumber,
            ifscCode: ifscCode || user.bankDetails?.ifscCode,
            accountType: accountType || user.bankDetails?.accountType,
            branch: branch || user.bankDetails?.branch,
            upiId: upiId || user.bankDetails?.upiId,
            upiName: upiName || user.bankDetails?.upiName,
            upiNumber: upiNumber || user.bankDetails?.upiNumber,
            upiType: upiType || user.bankDetails?.upiType,
            qrCode
        };

        // If admin is editing, it automatically gets approved
        user.bankStatus = "approved";
        user.bankRejectedReason = null;
        await user.save();

        await createNotification({
            userId: user._id,
            title: "Bank Details Updated 💳",
            message: "Admin ne aapke bank details update kiye hain.",
            type: "user",
            link: "/profile",
            createdBy: req.user.userId,
        });

        res.json({ message: "Bank details updated by Admin", success: true, bankDetails: user.bankDetails });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// POST /api/user/register-face — Employee registers their face descriptor
export const registerFace = async (req, res) => {
    try {
        const { faceDescriptor } = req.body;
        if (!faceDescriptor || !Array.isArray(faceDescriptor))
            return res.status(400).json({ message: "Face descriptor is required", success: false });
        await User.findByIdAndUpdate(req.user.userId, {
            "attendanceSettings.faceDescriptor": faceDescriptor
        });
        res.json({ message: "Face registered successfully", success: true });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// POST /api/user/verify-pin
export const verifySecurityPin = async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin) return res.status(400).json({ message: "PIN is required", success: false });
        
        const user = await User.findById(req.user.userId).populate("role");
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        const createPayrollToken = () => {
            return jwt.sign(
                { userId: user._id, role: user.role?.name, companyId: user.companyId, unlocked: true },
                process.env.JWT_SECRET || "Tom_and_Jerry",
                { expiresIn: "30m" }
            );
        };

        const isSuperAdmin = user.role?.name === "super_admin";
        let isMatch = false;

        if (isSuperAdmin) {
            // 1. Super Admin: check user's own securityPin in database
            if (user.securityPin) {
                isMatch = await bcrypt.compare(pin, user.securityPin);
            }
            // Super Admin can also unlock with company's PIN if user belongs to or views a company
            if (!isMatch && user.companyId) {
                const company = await Company.findById(user.companyId);
                if (company?.securityPin) {
                    isMatch = await bcrypt.compare(pin, company.securityPin);
                }
            }
            // Fallback for initial setup if no DB pin has been configured yet
            if (!isMatch && !user.securityPin && process.env.SUPER_ADMIN_PAYROLL_PIN) {
                isMatch = (pin === process.env.SUPER_ADMIN_PAYROLL_PIN);
            }
        } else {
            // 2. Company Admin: Company's securityPin is the single authoritative source of truth!
            if (user.companyId) {
                const company = await Company.findById(user.companyId);
                if (company?.securityPin) {
                    isMatch = await bcrypt.compare(pin, company.securityPin);
                }
            }
            // Fallback only if company has no securityPin configured yet
            if (!isMatch && user.securityPin && !user.companyId) {
                isMatch = await bcrypt.compare(pin, user.securityPin);
            }
        }

        if (!isMatch) {
            return res.status(400).json({ message: "Invalid Security PIN", success: false });
        }

        const payrollToken = createPayrollToken();
        res.json({ message: "PIN verified", success: true, payrollToken });
    } catch (error) {
        res.status(500).json({ message: error.message, success: false });
    }
};

// POST /api/user/forgot-payroll-pin (Sends OTP to user's registered email)
export const forgotPayrollPin = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate("role");
        if (!user) return res.status(404).json({ message: "User not found", success: false });

        const isAdminRole = ["super_admin", "admin"].includes(user.role?.name);
        if (!isAdminRole) {
            return res.status(403).json({ message: "Only Admins and Super Admins have Payroll PIN access", success: false });
        }

        const otp = generateOTP();
        user.payrollPinOtp = otp;
        user.payrollPinOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await user.save();

        const email = user.email;
        console.log(`\n================== [PAYROLL PIN OTP REQUEST] ==================`);
        console.log(`👤 User: ${user.firstName} ${user.lastName} (${email}) | Role: ${user.role?.name}`);
        console.log(`🔑 Generated 6-Digit OTP: >>> ${otp} <<< (Valid for 10 minutes)`);

        let mailResult = { ok: false, error: "No email" };
        if (email) {
            console.log(`📧 Sending OTP email to ${email}...`);
            mailResult = await sendMail({
                email,
                title: "WorkAstra HRMS - Payroll Security PIN Reset OTP",
                msg: resetPayrollPinOtpTemplate(user.firstName, otp)
            });
            if (mailResult?.ok) {
                console.log(`✅ [EMAIL SUCCESS] OTP email successfully sent! Message ID: ${mailResult.messageId}`);
            } else {
                console.error(`⚠️ [EMAIL WARNING] Failed to deliver OTP email: ${mailResult?.error || "Check email credentials"}`);
                console.log(`💡 [DEV TIP] You can use OTP: ${otp} directly from this terminal.`);
            }
        } else {
            console.error(`❌ [ERROR] No registered email address found for this user account.`);
        }
        console.log(`================================================================\n`);

        // Mask email for privacy (e.g. s***n@hrms.com)
        const [localPart, domainPart] = (email || "").split("@");
        const maskedLocal = localPart ? localPart[0] + "***" + (localPart.length > 1 ? localPart[localPart.length - 1] : "") : "";
        const maskedEmail = maskedLocal && domainPart ? `${maskedLocal}@${domainPart}` : email;

        res.status(200).json({
            message: `OTP sent successfully to your registered email (${maskedEmail})`,
            success: true,
            email: maskedEmail
        });
    } catch (error) {
        console.error(`❌ [EXCEPTION in forgotPayrollPin]:`, error);
        res.status(500).json({ message: error.message || "Failed to send reset OTP", success: false });
    }
};

// POST /api/user/reset-payroll-pin (Verifies OTP and resets Payroll PIN)
export const resetPayrollPin = async (req, res) => {
    try {
        const { otp, newPin } = req.body;
        console.log(`\n================== [PAYROLL PIN RESET ATTEMPT] ==================`);
        console.log(`📥 Incoming OTP: ${otp} | New PIN: ******`);

        if (!otp || !newPin) {
            console.error(`❌ [ERROR] Missing OTP or newPin in request body.`);
            return res.status(400).json({ message: "OTP and new 6-digit PIN are required", success: false });
        }

        if (!/^\d{6}$/.test(String(newPin).trim())) {
            console.error(`❌ [ERROR] New PIN format invalid (not 6 digits): ${newPin}`);
            return res.status(400).json({ message: "New PIN must be exactly 6 digits", success: false });
        }

        const user = await User.findById(req.user.userId).populate("role");
        if (!user) {
            console.error(`❌ [ERROR] User not found for ID: ${req.user.userId}`);
            return res.status(404).json({ message: "User not found", success: false });
        }

        console.log(`👤 User: ${user.firstName} ${user.lastName} (${user.email}) | Role: ${user.role?.name}`);
        console.log(`🔍 Comparing OTP: Entered [${String(otp).trim()}] vs Stored [${user.payrollPinOtp}]`);

        if (!user.payrollPinOtp || user.payrollPinOtp !== String(otp).trim()) {
            console.error(`❌ [ERROR] Invalid OTP! Does not match stored OTP.`);
            return res.status(400).json({ message: "Invalid OTP", success: false });
        }

        if (user.payrollPinOtpExpiry && user.payrollPinOtpExpiry < new Date()) {
            console.error(`❌ [ERROR] OTP expired at ${user.payrollPinOtpExpiry}. Current time: ${new Date()}`);
            return res.status(400).json({ message: "OTP has expired. Please request a new one.", success: false });
        }

        const hashedPin = await bcrypt.hash(String(newPin).trim(), 10);

        // If Super Admin, update user's own securityPin
        if (user.role?.name === "super_admin") {
            user.securityPin = hashedPin;
            console.log(`🔐 Super Admin securityPin updated with bcrypt hash.`);
        } else if (user.companyId) {
            // For Company Admin, update both company.securityPin and user.securityPin
            const company = await Company.findById(user.companyId);
            if (company) {
                company.securityPin = hashedPin;
                await company.save();
                console.log(`🏢 Company (${company.name}) securityPin updated with bcrypt hash.`);
            }
            user.securityPin = hashedPin;
        } else {
            user.securityPin = hashedPin;
        }

        // Clear OTP
        user.payrollPinOtp = null;
        user.payrollPinOtpExpiry = null;
        await user.save();

        console.log(`✅ [SUCCESS] Payroll PIN reset successfully completed! OTP cleared.`);
        console.log(`=================================================================\n`);

        // Also issue a fresh 30-minute payrollToken so user doesn't have to re-enter
        const payrollToken = jwt.sign(
            { userId: user._id, role: user.role?.name, companyId: user.companyId, unlocked: true },
            process.env.JWT_SECRET || "Tom_and_Jerry",
            { expiresIn: "30m" }
        );

        res.status(200).json({
            message: "Payroll Security PIN has been reset successfully!",
            success: true,
            payrollToken
        });
    } catch (error) {
        console.error(`❌ [EXCEPTION in resetPayrollPin]:`, error);
        res.status(500).json({ message: error.message || "Failed to reset PIN", success: false });
    }
};
