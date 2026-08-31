import express from "express";
import {
    submitResignation,
    getMyResignation,
    getAllResignations,
    updateResignationStatus,
    processClearance,
    adminSubmitExit,
    deleteResignation,
    restoreEmployee,
    downloadExperienceLetter,
    downloadSalarySlips
} from "../controller/ResignationController.js";
import { protect, hasPermission } from "../middleware/authMiddleware.js";

const router = express.Router();

// Employee endpoints
// (Disabled/Hidden on frontend but kept for API backward compatibility or we can remove it)
router.post("/", protect, submitResignation);
router.get("/my-resignation", protect, getMyResignation);

// Admin/HR endpoints
router.post("/admin-exit", protect, hasPermission("MANAGE_RESIGNATIONS"), adminSubmitExit);
router.get("/", protect, hasPermission("MANAGE_RESIGNATIONS"), getAllResignations);
router.patch("/:id/status", protect, hasPermission("MANAGE_RESIGNATIONS"), updateResignationStatus);
router.patch("/:id/clearance", protect, hasPermission("MANAGE_RESIGNATIONS"), processClearance);
router.delete("/:id", protect, hasPermission("MANAGE_RESIGNATIONS"), deleteResignation);
router.patch("/:id/restore", protect, hasPermission("MANAGE_RESIGNATIONS"), restoreEmployee);

// Experience Letter Download endpoint
router.get("/:id/experience-letter", protect, hasPermission("MANAGE_RESIGNATIONS"), downloadExperienceLetter);

// Salary Slips Download endpoint
router.get("/:id/salary-slips", protect, hasPermission("MANAGE_RESIGNATIONS"), downloadSalarySlips);

export default router;
