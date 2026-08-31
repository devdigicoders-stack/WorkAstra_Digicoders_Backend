import express from "express";
import { registerUser, loginUser, forgotPassword, resetPassword, adminChangePassword, getAllUsers, getAllUsersByCompany, verifyToken, getUserProfile, updateUserProfile, adminUpdateUser, toggleUserStatus, logoutUser, changePassword, deleteUser, saveFcmToken, getUpcomingEvents, getAllClients, getGreetingCardUrl, submitBankDetails, getMyBankDetails, approveBankDetails, rejectBankDetails, adminEditBankDetails } from "../controller/UserController.js";
import upload from "../middleware/multer.js";
import { protect, hasPermission } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/signup", registerUser);
router.post("/create", protect, upload.single("finalProposal"), registerUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/logout", logoutUser);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, upload.single("profilePic"), updateUserProfile);

// Bank & UPI Details
router.get("/bank-details", protect, getMyBankDetails);
router.put("/bank-details", protect, upload.single("qrCode"), submitBankDetails);
router.patch("/:id/bank-details/approve", protect, approveBankDetails);
router.patch("/:id/bank-details/reject", protect, rejectBankDetails);
router.put("/:id/bank-details/admin-edit", protect, upload.single("qrCode"), adminEditBankDetails);

// Get Clients Route
router.get("/clients", protect, getAllClients);

router.patch("/change-password", protect, changePassword);
router.patch("/:id/change-password", protect, hasPermission("UPDATE_USER"), adminChangePassword);
router.put("/:id", protect, upload.single("finalProposal"), adminUpdateUser);
router.patch("/:id/toggle-status", protect, toggleUserStatus);
router.delete("/:id", protect, hasPermission("DELETE_USER"), deleteUser);
router.get("/all", protect, getAllUsers);
router.get("/company/:companyId/users", protect, getAllUsersByCompany);
router.get("/me", protect, verifyToken);
router.get("/upcoming-events", protect, getUpcomingEvents);
router.get("/greeting-card", protect, getGreetingCardUrl);
router.post("/save-fcm-token", protect, saveFcmToken);

export default router;