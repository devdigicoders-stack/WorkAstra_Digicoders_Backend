import express from "express";
import https from "https";
import http from "http";
import path from "path";
import fs from "fs";
import { protect } from "../middleware/authMiddleware.js";
import upload from "../middleware/multer.js";
import {
    createProject, getProjects, getProjectById, updateProject, deleteProject,
    getFileBundles, createFileBundle, updateFileBundle, deleteFileBundle, updateBundleAccess,
} from "../controller/ProjectController.js";

const router = express.Router();
router.use(protect);

// Proxy download — fetches file server-side and streams with correct filename
router.get("/download-proxy", (req, res) => {
    try {
        const { url, name } = req.query;
        if (!url) return res.status(400).json({ message: "url required" });

        const decodedRaw = decodeURIComponent(url).split("?")[0];
        const fallbackName = path.basename(decodedRaw) || "file";
        const safeName = (name || fallbackName).replace(/[^\w\s.-]/g, "_");

        const uploadBaseDir = path.join(process.cwd(), "uploads");

        // 1. Resolve local path on disk if it matches uploads
        let localCandidate = null;
        if (decodedRaw.includes("/uploads/")) {
            const sub = decodedRaw.substring(decodedRaw.indexOf("/uploads/") + "/uploads/".length);
            localCandidate = path.join(uploadBaseDir, sub);
        } else if (decodedRaw.startsWith("uploads/")) {
            const sub = decodedRaw.substring("uploads/".length);
            localCandidate = path.join(uploadBaseDir, sub);
        } else if (!decodedRaw.startsWith("http://") && !decodedRaw.startsWith("https://")) {
            localCandidate = path.join(uploadBaseDir, path.basename(decodedRaw));
        }

        if (localCandidate && fs.existsSync(localCandidate) && fs.statSync(localCandidate).isFile()) {
            return res.download(localCandidate, safeName, (err) => {
                if (err && !res.headersSent) {
                    console.error("Local file download error:", err);
                    return res.status(500).json({ message: "Download failed" });
                }
            });
        }

        // Check if file exists directly from cwd
        const cwdCandidate = path.join(process.cwd(), decodedRaw.replace(/^\/+/, ""));
        if (fs.existsSync(cwdCandidate) && fs.statSync(cwdCandidate).isFile()) {
            return res.download(cwdCandidate, safeName, (err) => {
                if (err && !res.headersSent) {
                    console.error("CWD file download error:", err);
                    return res.status(500).json({ message: "Download failed" });
                }
            });
        }

        // 2. If it's a remote URL (e.g. Cloudinary, S3), stream it
        if (url.startsWith("http://") || url.startsWith("https://")) {
            const doRequest = (targetUrl, hops = 0) => {
                if (hops > 5) return res.status(500).json({ message: "Too many redirects" });
                try {
                    const parsedUrl = new URL(targetUrl);
                    const client = parsedUrl.protocol === "https:" ? https : http;

                    const clientReq = client.get(targetUrl, (upstream) => {
                        if ([301, 302, 307, 308].includes(upstream.statusCode)) {
                            upstream.resume();
                            const redirectLocation = upstream.headers.location;
                            if (!redirectLocation) {
                                return res.status(500).json({ message: "Redirect with no location" });
                            }
                            const nextUrl = new URL(redirectLocation, targetUrl).toString();
                            return doRequest(nextUrl, hops + 1);
                        }

                        if (upstream.statusCode >= 400) {
                            return res.status(upstream.statusCode).json({ message: `Upstream error: ${upstream.statusCode}` });
                        }

                        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
                        res.setHeader("Content-Type", upstream.headers["content-type"] || "application/octet-stream");
                        upstream.pipe(res);
                    });

                    clientReq.on("error", (err) => {
                        console.error("Proxy download error:", err);
                        if (!res.headersSent) {
                            res.status(500).json({ message: "Download failed" });
                        }
                    });
                } catch (err) {
                    console.error("Invalid target URL in download-proxy:", err);
                    if (!res.headersSent) {
                        res.status(400).json({ message: "Invalid URL" });
                    }
                }
            };

            return doRequest(url);
        }

        // File not found on disk and not a valid remote URL
        return res.status(404).json({ message: "File not found on server" });
    } catch (err) {
        console.error("Download proxy unexpected error:", err);
        if (!res.headersSent) {
            res.status(500).json({ message: "Download failed" });
        }
    }
});
router.post("/", createProject);
router.get("/", getProjects);
router.get("/:id", getProjectById);
router.put("/:id", updateProject);
router.delete("/:id", deleteProject);

router.get("/:id/bundles", getFileBundles);
router.post("/:id/bundles", upload.array("files", 10), createFileBundle);
router.put("/:id/bundles/:bundleId", upload.array("files", 10), updateFileBundle);
router.delete("/:id/bundles/:bundleId", deleteFileBundle);
router.patch("/:id/bundles/:bundleId/access", updateBundleAccess);

export default router;
