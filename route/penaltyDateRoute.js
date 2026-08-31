import express from "express";
import { addPenaltyDate, getPenaltyDates, deletePenaltyDate } from "../controller/PenaltyDateController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, addPenaltyDate);
router.get("/", protect, getPenaltyDates);
router.delete("/:id", protect, deletePenaltyDate);

export default router;
