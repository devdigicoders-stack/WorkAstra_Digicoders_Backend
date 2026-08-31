import express from "express";
import { createBranch, getBranches, getBranchesByCompany, updateBranch, deleteBranch } from "../controller/BranchController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, createBranch);
router.get("/", protect, getBranches);
router.get("/by-company/:companyId", protect, getBranchesByCompany);
router.put("/:id", protect, updateBranch);
router.delete("/:id", protect, deleteBranch);

export default router;
