import Nda from "../models/NdaSchema.js";
import NdaSignature from "../models/NdaSignatureSchema.js";
import User from "../models/UserSchema.js";
import Role from "../models/roleSchema.js";
import { createNotification } from "../utills/notificationHelper.js";
import { uploadToCloudinary, uploadBufferToCloudinary } from "../middleware/multer.js";
import { sendMail } from "../utills/SendEmail.js";
import { ndaOtpTemplate } from "../utills/emailTemplates/userTemplate.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Admin creates or updates an NDA
export const createOrUpdateNda = async (req, res) => {
    try {
        const { title, companyId, documentId, targetAudience } = req.body;
        
        if (!title) {
            return res.status(400).json({ message: "Title is required", success: false });
        }

        let documentUrl = "";
        
        if (req.file) {
            const uploadDir = path.join(__dirname, '../uploads/ndas');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            
            const ext = path.extname(req.file.originalname) || '';
            const filename = `original_nda_${Date.now()}${ext}`;
            const filePath = path.join(uploadDir, filename);
            
            const fileData = fs.readFileSync(req.file.path);
            fs.writeFileSync(filePath, fileData);
            
            // Delete temp file created by multer
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            
            documentUrl = `${req.protocol}://${req.get('host')}/uploads/ndas/${filename}`;
        }

        let nda = null;
        if (documentId) {
            nda = await Nda.findById(documentId);
        }

        // If this is a Client NDA, disable all other Client NDAs
        if (targetAudience === 'Client') {
            await Nda.updateMany({ targetAudience: 'Client' }, { $set: { status: false } });
        }

        if (nda) {
            nda.title = title;
            if (targetAudience) nda.targetAudience = targetAudience;
            if (req.file) {
                nda.document = { url: documentUrl };
            }
            // Ensure this one is active
            if (targetAudience === 'Client') nda.status = true;
            
            nda.updatedBy = req.user.userId;
            await nda.save();
            return res.status(200).json({ message: "NDA updated successfully", nda, success: true });
        } else {
            if (!req.file) {
                return res.status(400).json({ message: "Document file is required for new NDA", success: false });
            }
            nda = new Nda({
                title,
                document: { url: documentUrl },
                companyId: companyId || null,
                targetAudience: targetAudience || "Both",
                createdBy: req.user.userId
            });
            await nda.save();
            return res.status(201).json({ message: "NDA created successfully", nda, success: true });
        }
    } catch (error) {
        console.error("NDA Create/Update Error:", error);
        res.status(500).json({ message: "Error saving NDA", success: false });
    }
};

// Admin gets all NDAs
export const getAllNdas = async (req, res) => {
    try {
        const { companyId, manage } = req.query;
        let filter = companyId ? { $or: [{ companyId }, { companyId: null }] } : { companyId: null };
        
        // Role-based filtering
        const userRole = (req.user.role || "").toLowerCase();
        
        // If they are on the Manage page and have management rights, show all NDAs
        if (manage === "true" && (userRole === "super_admin" || userRole === "admin" || userRole === "hr")) {
            // No targetAudience filter -> show everything
        } else {
            // If they are on the View/Sign page, filter by their actual role
            if (userRole === "intern") {
                filter.targetAudience = { $in: ["Intern", "Both"] };
            } else {
                // Employees, HR, Admins (when signing) only see Employee NDAs
                filter.targetAudience = { $in: ["Employee", "Both"] };
            }
        }
        
        const ndas = await Nda.find(filter);
        res.status(200).json({ ndas, success: true });
    } catch (error) {
        console.error("Get All NDAs Error:", error);
        res.status(500).json({ message: "Error fetching NDAs", success: false });
    }
};

// User signs an NDA
export const signNda = async (req, res) => {
    try {
        const { ndaId } = req.params;
        const { signatureBase64, employeeDetails, witnessDetails } = req.body;

        if (!signatureBase64) {
            return res.status(400).json({ message: "Signature is required", success: false });
        }

        // Check if already signed
        const existing = await NdaSignature.findOne({ ndaId, userId: req.user.userId });
        if (existing) {
            return res.status(400).json({ message: "You have already signed this NDA", success: false });
        }

        // Get Original NDA
        const nda = await Nda.findById(ndaId);
        if (!nda) return res.status(404).json({ message: "NDA not found", success: false });

        // Fetch User and details
        const user = await User.findById(req.user.userId)
            .populate('designation', 'name title')
            .populate('department', 'name title');

        const empData = {
            fullName: employeeDetails?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
            fatherName: employeeDetails?.fatherName || '',
            employeeId: employeeDetails?.employeeId || user?.employeeCode || `EMP-${user?._id?.toString().slice(-4)}`,
            designation: employeeDetails?.designation || user?.designation?.name || user?.designation?.title || 'Employee',
            phone: employeeDetails?.phone || user?.phone || '',
            email: employeeDetails?.email || user?.email || '',
            address: employeeDetails?.address || user?.address || ''
        };

        const witData = {
            fullName: witnessDetails?.fullName || '',
            address: witnessDetails?.address || '',
            phone: witnessDetails?.phone || '',
            role: witnessDetails?.role || '',
            signatureBase64: witnessDetails?.signatureBase64 || null
        };

        let signedDocumentUrl = "";

        try {
            // Load base NDA template
            let docBytes;
            const localTemplatePath = path.join(__dirname, '../templates/Employee_NDA_DigiCoders.pdf');
            if (fs.existsSync(localTemplatePath)) {
                docBytes = fs.readFileSync(localTemplatePath);
            } else if (nda.document && nda.document.url) {
                const docResponse = await axios.get(nda.document.url, { responseType: 'arraybuffer' });
                docBytes = docResponse.data;
            }

            if (docBytes) {
                const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
                const pdfDoc = await PDFDocument.load(docBytes);
                const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

                const pages = pdfDoc.getPages();
                const now = new Date();
                const dayStr = String(now.getDate()).padStart(2, '0');
                const monthName = now.toLocaleString('en-US', { month: 'long' });
                const monthNum = String(now.getMonth() + 1).padStart(2, '0');
                const yearShort = String(now.getFullYear()).slice(-2);

                // --- 1. STAMP PAGE 1 ---
                if (pages.length > 0) {
                    const page1 = pages[0];

                    const inkColor = rgb(0.05, 0.15, 0.4);

                    // Date Header
                    page1.drawText(dayStr, { x: 200, y: 665.3, size: 8.5, font, color: inkColor });
                    page1.drawText(monthName, { x: 247, y: 665.3, size: 8.5, font, color: inkColor });
                    page1.drawText(yearShort, { x: 312, y: 665.3, size: 8.5, font, color: inkColor });

                    // Employee Profile Details
                    page1.drawText(empData.fullName, { x: 116, y: 561.8, size: 8.5, font, color: inkColor });
                    if (empData.fatherName) {
                        page1.drawText(empData.fatherName, { x: 334, y: 561.8, size: 8.5, font, color: inkColor });
                    }
                    page1.drawText(empData.employeeId, { x: 145, y: 542.6, size: 8.5, font, color: inkColor });
                    page1.drawText(empData.designation, { x: 364, y: 542.6, size: 8.5, font, color: inkColor });
                    page1.drawText(empData.phone, { x: 135, y: 523.2, size: 8.5, font, color: inkColor });
                    page1.drawText(empData.email, { x: 346, y: 523.2, size: 8.5, font, color: inkColor });
                    
                    const addrFontSize = empData.address.length > 50 ? 7 : 8;
                    page1.drawText(empData.address, { x: 120, y: 504.0, size: addrFontSize, font, color: inkColor });
                }

                // --- 2. STAMP PAGE 9 (OR LAST PAGE) ---
                const pageLast = pages.length >= 9 ? pages[8] : pages[pages.length - 1];
                const inkColor = rgb(0.05, 0.15, 0.4);

                // Embed Company Seal & Gopal Sir Signature
                const stampPath = path.join(__dirname, '../templates/assets/digicodersstamp.png');
                const gopalSignPath = path.join(__dirname, '../templates/assets/gopalsirsign.png');

                if (fs.existsSync(gopalSignPath)) {
                    const gopalBytes = fs.readFileSync(gopalSignPath);
                    const gopalImage = await pdfDoc.embedPng(gopalBytes);
                    pageLast.drawImage(gopalImage, { x: 135, y: 492, width: 70, height: 26 });
                }
                // Gopal Sir Date
                pageLast.drawText(dayStr, { x: 104, y: 472.1, size: 8.5, font, color: inkColor });
                pageLast.drawText(monthNum, { x: 138, y: 472.1, size: 8.5, font, color: inkColor });
                pageLast.drawText(yearShort, { x: 178, y: 472.1, size: 8.5, font, color: inkColor });

                if (fs.existsSync(stampPath)) {
                    const stampBytes = fs.readFileSync(stampPath);
                    const stampImage = await pdfDoc.embedPng(stampBytes);
                    pageLast.drawImage(stampImage, { x: 155, y: 375, width: 52, height: 52 });
                }

                // Left Column: Employee Details
                pageLast.drawText(empData.fullName, { x: 128, y: 329.8, size: 8.5, font, color: inkColor });
                pageLast.drawText(empData.employeeId, { x: 145, y: 310.3, size: 8.5, font, color: inkColor });
                pageLast.drawText(empData.designation, { x: 139, y: 291.1, size: 8.5, font, color: inkColor });
                pageLast.drawText(empData.phone, { x: 153, y: 271.7, size: 8.5, font, color: inkColor });
                pageLast.drawText(empData.email, { x: 151, y: 252.2, size: 8.5, font, color: inkColor });
                const leftAddrSize = empData.address.length > 35 ? 7 : 8;
                pageLast.drawText(empData.address, { x: 122, y: 233.0, size: leftAddrSize, font, color: inkColor });

                // Left Column: Employee Signature
                if (signatureBase64) {
                    const empSignBase64 = signatureBase64.includes('base64,') ? signatureBase64.split('base64,')[1] : signatureBase64;
                    const empSignBytes = Buffer.from(empSignBase64, 'base64');
                    const empSignImage = await pdfDoc.embedPng(empSignBytes);
                    pageLast.drawImage(empSignImage, { x: 135, y: 177, width: 70, height: 26 });
                }

                // Left Column: Employee Date
                pageLast.drawText(dayStr, { x: 104, y: 155.5, size: 8.5, font, color: inkColor });
                pageLast.drawText(monthNum, { x: 138, y: 155.5, size: 8.5, font, color: inkColor });
                pageLast.drawText(yearShort, { x: 178, y: 155.5, size: 8.5, font, color: inkColor });

                // Right Column: Witness Details
                if (witData.fullName) {
                    pageLast.drawText(witData.fullName, { x: 352, y: 329.8, size: 8.5, font, color: inkColor });
                }
                if (witData.address) {
                    const witAddrSize = witData.address.length > 30 ? 7 : 8;
                    pageLast.drawText(witData.address, { x: 362, y: 310.3, size: witAddrSize, font, color: inkColor });
                }
                if (witData.phone) {
                    pageLast.drawText(witData.phone, { x: 393, y: 291.1, size: 8.5, font, color: inkColor });
                }
                if (witData.role) {
                    pageLast.drawText(witData.role, { x: 315, y: 252.2, size: 8.5, font, color: inkColor });
                }

                // Right Column: Witness Signature & Date
                // Witness Signature
                if (witData.signatureBase64) {
                    try {
                        const witSignBase64 = witData.signatureBase64.includes('base64,') ? witData.signatureBase64.split('base64,')[1] : witData.signatureBase64;
                        const witSignBytes = Buffer.from(witSignBase64, 'base64');
                        const witSignImage = await pdfDoc.embedPng(witSignBytes);
                        pageLast.drawImage(witSignImage, { x: 370, y: 188, width: 65, height: 26 });
                    } catch (e) {
                        pageLast.drawText(witData.fullName || 'Witness', { x: 380, y: 194.4, size: 8.5, font, color: inkColor });
                    }
                } else if (witData.fullName) {
                    pageLast.drawText(witData.fullName, { x: 380, y: 194.4, size: 8.5, font, color: inkColor });
                }

                // Witness Date
                pageLast.drawText(dayStr, { x: 345, y: 175.0, size: 8.5, font, color: inkColor });
                pageLast.drawText(monthNum, { x: 379, y: 175.0, size: 8.5, font, color: inkColor });
                pageLast.drawText(yearShort, { x: 419, y: 175.0, size: 8.5, font, color: inkColor });

                // Save signed PDF
                const modifiedPdfBytes = await pdfDoc.save();
                const modifiedPdfBuffer = Buffer.from(modifiedPdfBytes);

                const signedDir = path.join(__dirname, '../uploads/ndas/signed');
                if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });

                const filename = `signed_nda_${ndaId}_${req.user.userId}_${Date.now()}.pdf`;
                const filePath = path.join(signedDir, filename);
                fs.writeFileSync(filePath, modifiedPdfBuffer);

                signedDocumentUrl = `${req.protocol}://${req.get('host')}/uploads/ndas/signed/${filename}`;
            }
        } catch (err) {
            console.error("PDF Stamping Error:", err);
            return res.status(500).json({ message: "Error stamping NDA document.", success: false });
        }

        const signature = new NdaSignature({
            ndaId,
            userId: req.user.userId,
            signatureBase64,
            signedDocumentUrl,
            employeeDetails: empData,
            witnessDetails: witData,
            signedAt: new Date()
        });

        await signature.save();

        try {
            const roles = await Role.find({ name: { $in: ["super_admin", "admin", "hr"] } }).select("_id");
            const roleIds = roles.map(r => r._id);
            const filter = { role: { $in: roleIds }, isActive: true };
            if (user?.companyId) filter.$or = [{ companyId: user.companyId }, { companyId: null }];
            const admins = await User.find(filter).select("_id");
            const adminIds = admins.map(a => a._id);

            if (adminIds.length > 0) {
                await createNotification({
                    userId: adminIds,
                    title: "NDA Signed ✍️",
                    message: `${empData.fullName || 'Employee'} has signed the NDA: ${nda.title}`,
                    type: "company",
                    link: "/nda",
                    createdBy: req.user.userId
                });
            }
        } catch (err) {
            console.error("Failed to notify HR/Admin for NDA", err);
        }

        res.status(201).json({ message: "NDA signed successfully", signedDocumentUrl, success: true });
    } catch (error) {
        console.error("Sign NDA Error:", error);
        res.status(500).json({ message: "Error signing NDA", success: false });
    }
};

// Get all signatures for an NDA (for admin)
export const getNdaSignatures = async (req, res) => {
    try {
        const { ndaId } = req.params;
        const signatures = await NdaSignature.find({ ndaId }).populate('userId', 'firstName lastName email employeeCode profilePic');
        res.status(200).json({ signatures, success: true });
    } catch (error) {
        console.error("Get Signatures Error:", error);
        res.status(500).json({ message: "Error fetching signatures", success: false });
    }
};

// Get NDAs signed by current user
export const getMySignatures = async (req, res) => {
    try {
        const signatures = await NdaSignature.find({ userId: req.user.userId }).populate('ndaId', 'title document targetAudience');
        res.status(200).json({ signatures, success: true });
    } catch (error) {
        console.error("Get My Signatures Error:", error);
        res.status(500).json({ message: "Error fetching your signatures", success: false });
    }
};

// Admin deletes an NDA
export const deleteNda = async (req, res) => {
    try {
        const { id } = req.params;
        const nda = await Nda.findByIdAndDelete(id);
        if (!nda) return res.status(404).json({ message: "NDA not found", success: false });
        
        // Delete all signatures associated with this NDA
        await NdaSignature.deleteMany({ ndaId: id });
        
        res.status(200).json({ message: "NDA deleted successfully", success: true });
    } catch (error) {
        console.error("Delete NDA Error:", error);
        res.status(500).json({ message: "Error deleting NDA", success: false });
    }
};

// Client skips NDA
export const skipClientNda = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        
        user.clientNdaStatus = "skipped";
        await user.save();
        
        res.json({ message: "NDA skipped successfully", success: true });
    } catch (error) {
        console.error("Skip Client NDA Error:", error);
        res.status(500).json({ message: "Error skipping NDA", success: false });
    }
};

// Client requests OTP for NDA signature
export const sendClientNdaOtp = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        
        if (user.clientNdaStatus === "signed") {
            return res.status(400).json({ message: "NDA already signed", success: false });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await user.save();

        await sendMail({ 
            email: user.email, 
            title: "Verify Your NDA Signature", 
            msg: ndaOtpTemplate(user.firstName, otp) 
        });

        res.json({ message: "OTP sent to your email", success: true });
    } catch (error) {
        console.error("Send Client NDA OTP Error:", error);
        res.status(500).json({ message: "Error sending OTP", success: false });
    }
};

// Client signs NDA
export const signClientNda = async (req, res) => {
    try {
        const { signatureBase64, otp } = req.body;
        if (!signatureBase64) return res.status(400).json({ message: "Signature is required", success: false });
        if (!otp) return res.status(400).json({ message: "OTP is required", success: false });

        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: "User not found", success: false });
        
        if (user.clientNdaStatus === "signed") {
            return res.status(400).json({ message: "NDA already signed", success: false });
        }

        if (!user.otp || user.otp !== otp) {
            return res.status(400).json({ message: "Invalid OTP", success: false });
        }
        if (user.otpExpiry < new Date()) {
            return res.status(400).json({ message: "OTP has expired. Please request a new one.", success: false });
        }

        // Clear OTP after successful verification
        user.otp = null;
        user.otpExpiry = null;

        // Find active Client NDA template
        const clientNda = await Nda.findOne({ targetAudience: 'Client', status: true });
        
        let signedDocumentUrl = "";

        if (clientNda && clientNda.document && clientNda.document.url) {
            try {
                // Fetch the PDF from URL (works for local uploads and cloudinary)
                const pdfResponse = await axios.get(clientNda.document.url, { responseType: 'arraybuffer' });
                const docBytes = pdfResponse.data;
                
                const pdfDoc = await PDFDocument.load(docBytes);
                const signatureImageBytes = Buffer.from(signatureBase64.split(',')[1], 'base64');
                const signatureImage = await pdfDoc.embedPng(signatureImageBytes);
                
                const pages = pdfDoc.getPages();
                const sigDims = signatureImage.scale(0.3);
                
                pages.forEach((page) => {
                    const { width } = page.getSize();
                    page.drawImage(signatureImage, {
                        x: width - sigDims.width - 50, // Right side with 50px padding
                        y: 50,
                        width: sigDims.width,
                        height: sigDims.height,
                    });
                });
                
                const modifiedPdfBytes = await pdfDoc.save();
                const modifiedPdfBuffer = Buffer.from(modifiedPdfBytes);
                
                const signedDir = path.join(__dirname, '../uploads/ndas/signed');
                if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });
                
                const filename = `client_signed_nda_${req.user.userId}_${Date.now()}.pdf`;
                const filePath = path.join(signedDir, filename);
                fs.writeFileSync(filePath, modifiedPdfBuffer);
                
                signedDocumentUrl = `${req.protocol}://${req.get('host')}/uploads/ndas/signed/${filename}`;
            } catch (pdfErr) {
                console.error("PDF Stamping Error:", pdfErr);
            }
        }

        user.clientNdaStatus = "signed";
        await user.save();

        // Save a signature record to keep track of document URL
        const signature = new NdaSignature({
            userId: req.user.userId,
            ndaId: clientNda ? clientNda._id : undefined,
            signatureBase64,
            signedDocumentUrl
        });
        await signature.save();

        // Notify Super Admin
        try {
            const roles = await Role.find({ name: { $in: ["super_admin", "admin"] } }).select("_id");
            const roleIds = roles.map(r => r._id);
            const filter = { role: { $in: roleIds }, isActive: true };
            if (user.companyId) filter.$or = [{ companyId: user.companyId }, { companyId: null }];
            const admins = await User.find(filter).select("_id");
            const adminIds = admins.map(a => a._id);
            
            if (adminIds.length > 0) {
                await createNotification({
                    userId: adminIds,
                    title: "Client NDA Signed ✍️",
                    message: `Client ${user.firstName || ''} ${user.lastName || ''} has signed their NDA.`,
                    type: "company",
                    link: "/nda",
                    createdBy: req.user.userId
                });
            }
            // bbbb
        } catch (err) {
            console.error("Failed to notify Admin for Client NDA", err);
        }

        res.json({ message: "Client NDA signed successfully", signedDocumentUrl, success: true });
    } catch (error) {
        console.error("Sign Client NDA Error:", error);
        res.status(500).json({ message: error.message || "Error signing Client NDA", success: false });
    }
};

// Admin gets all client NDA signatures
export const getClientNdaSignatures = async (req, res) => {
    try {
        const clientNdas = await Nda.find({ targetAudience: 'Client' }).select('_id');
        const clientNdaIds = clientNdas.map(nda => nda._id);

        const signatures = await NdaSignature.find({
            $or: [
                { ndaId: { $exists: false } },
                { ndaId: null },
                { ndaId: { $in: clientNdaIds } }
            ]
        })
            .populate('userId', 'firstName lastName email profilePic clientNdaStatus')
            .populate('ndaId', 'title')
            .sort({ createdAt: -1 });
            
        res.status(200).json({ signatures, success: true });
    } catch (error) {
        console.error("Get Client Signatures Error:", error);
        res.status(500).json({ message: "Error fetching client signatures", success: false });
    }
};

// Get active Client NDA template for client login
export const getClientNdaTemplate = async (req, res) => {
    try {
        const clientNda = await Nda.findOne({ targetAudience: 'Client', status: true });
        
        if (!clientNda) {
            return res.status(200).json({ nda: null, message: "No active Client NDA found", success: true });
        }
        
        res.status(200).json({ nda: clientNda, success: true });
    } catch (error) {
        console.error("Get Client NDA Template Error:", error);
        res.status(500).json({ message: "Error fetching Client NDA template", success: false });
    }
};

export const getEmployeeSignatures = async (req, res) => {
    try {
        const { userId } = req.params;
        const signatures = await NdaSignature.find({ userId }).populate('ndaId', 'title document targetAudience');
        res.status(200).json({ signatures, success: true });
    } catch (error) {
        console.error("Get Employee Signatures Error:", error);
        res.status(500).json({ message: "Error fetching employee signatures", success: false });
    }
};
