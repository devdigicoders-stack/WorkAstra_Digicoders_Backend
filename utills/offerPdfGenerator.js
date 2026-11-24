import fs from "fs";
import path from "path";
import axios from "axios";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const systemChromePaths = () => {
    if (process.platform === "win32") {
        const local = process.env.LOCALAPPDATA || "";
        const pf = process.env.ProgramFiles || "C:\\Program Files";
        const pfx86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        return [
            path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        ];
    }
    if (process.platform === "darwin") {
        return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    }
    return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ];
};

/** Bundled Puppeteer Chrome → PUPPETEER_EXECUTABLE_PATH → system Chrome */
export const resolveChromeExecutable = () => {
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    for (const candidate of systemChromePaths()) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch (_) {}
    }

    return null;
};

/**
 * Robust image loader - supports Base64 Data URI, HTTP/HTTPS, and local disk paths
 */
const loadImageBytes = async (logoUrl) => {
    if (!logoUrl) return null;
    try {
        if (logoUrl.startsWith("data:")) {
            const base64Data = logoUrl.split(",")[1];
            return Buffer.from(base64Data, "base64");
        }
        if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
            const resp = await axios.get(logoUrl, { responseType: "arraybuffer", timeout: 6000 });
            return Buffer.from(resp.data);
        }
        const relPath = logoUrl.replace(/^\//, "");
        const candidates = [
            path.join(process.cwd(), relPath),
            path.join(process.cwd(), "uploads", path.basename(relPath)),
            path.resolve("uploads", path.basename(relPath)),
            path.resolve(relPath)
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return fs.readFileSync(p);
            }
        }
    } catch (e) {
        console.warn("Could not load logo image bytes:", e.message);
    }
    return null;
};

/**
 * Pure pdf-lib Single Master Generator
 * - Zero Chrome / Puppeteer dependency
 * - Zero server setup needed (works everywhere)
 * - Beautiful centered header logo
 * - Large transparent watermark on BOTH Page 1 & Page 2
 * - Identical output on Laptop, Phone, and all devices
 */
export const generateOfferPdfWithPdfLib = async (data = {}) => {
    const {
        userName = "Employee",
        address = "Corporate Head Office - Lucknow",
        designation = "Developer",
        companyName = "DigiCoders Technologies Private Limited",
        ctc = "0",
        joinDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        logoUrl = ""
    } = data;

    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    const wrapText = (text, font, size, maxWidth) => {
        const words = text.split(" ");
        const lines = [];
        let currentLine = "";

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = font.widthOfTextAtSize(testLine, size);
            if (width <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
    };

    // Embed Logo if available
    let embeddedLogo = null;
    const imageBytes = await loadImageBytes(logoUrl);
    if (imageBytes) {
        try {
            embeddedLogo = await pdfDoc.embedPng(imageBytes);
        } catch (_) {
            try {
                embeddedLogo = await pdfDoc.embedJpg(imageBytes);
            } catch (e) {
                console.warn("Could not embed image as PNG/JPG:", e.message);
            }
        }
    }

    // ──────────────────────────────────────────────
    // --- PAGE 1 ---
    // ──────────────────────────────────────────────
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);

    // Draw Watermark on Page 1 (BEFORE text so text is on top)
    if (embeddedLogo) {
        const wmDims = embeddedLogo.scaleToFit(pageWidth * 0.72, pageHeight * 0.42);
        page1.drawImage(embeddedLogo, {
            x: (pageWidth - wmDims.width) / 2,
            y: (pageHeight - wmDims.height) / 2,
            width: wmDims.width,
            height: wmDims.height,
            opacity: 0.13
        });
    }

    const topMargin = 45;
    let y = pageHeight - topMargin;

    // Header Logo (Centered)
    if (embeddedLogo) {
        const headerDims = embeddedLogo.scaleToFit(145, 62);
        page1.drawImage(embeddedLogo, {
            x: (pageWidth - headerDims.width) / 2,
            y: y - headerDims.height,
            width: headerDims.width,
            height: headerDims.height
        });
        y -= (headerDims.height + 20);
    } else {
        const compWidth = fontBold.widthOfTextAtSize(companyName, 16);
        page1.drawText(companyName, {
            x: (pageWidth - compWidth) / 2,
            y: y - 16,
            size: 16,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1)
        });
        y -= 25;
    }

    // Title: Offer Letter (Centered & Underlined)
    const titleText = "Offer Letter";
    const titleWidth = fontBold.widthOfTextAtSize(titleText, 17);
    const titleX = (pageWidth - titleWidth) / 2;
    page1.drawText(titleText, {
        x: titleX,
        y,
        size: 17,
        font: fontBold,
        color: rgb(0, 0, 0)
    });
    page1.drawLine({
        start: { x: titleX, y: y - 4 },
        end: { x: titleX + titleWidth, y: y - 4 },
        thickness: 1.2,
        color: rgb(0, 0, 0)
    });
    y -= 48; // Ample gap between "Offer Letter" title and "Dated:"

    // Metadata
    page1.drawText(`Dated: ${today}`, { x: margin, y, size: 10.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    y -= 20;
    page1.drawText(`Mr ${userName}`, { x: margin, y, size: 10.8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 18;

    const addressLines = wrapText(`B/o ${address}`, fontRegular, 10.2, contentWidth);
    for (const line of addressLines) {
        page1.drawText(line, { x: margin, y, size: 10.2, font: fontRegular, color: rgb(0.25, 0.25, 0.25) });
        y -= 16;
    }
    y -= 6;

    const firstName = userName.split(" ")[0] || userName;
    page1.drawText(`Dear ${firstName},`, { x: margin, y, size: 10.8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 24;

    // Paragraphs
    const paragraphs = [
        `We are pleased to inform you that, with reference to your application and subsequent interview you had with us, we are pleased to offer you as a "${designation}" at our Corporate Head Office - Lucknow, on the terms and conditions discussed and agreed by you at the time of your interview. You are requested to join us on ${joinDate} as agreed by you. Your monthly remuneration will be ${ctc} INR and Your work timings will be 10:00AM to 07:00PM, Monday to Saturday. You will be on probation period for first 3 months, after serving the probation period your performance and efforts will be reviewed to continue as permanent employee in ${companyName}. You will also get some incentive & increment for your Better Performance.`,
        `We Will also review your performance and work every year and you will get benefits as per them. And your salary will be revised as per performance.`,
        `As per the acceptance of this offer letter, you will also accept the attached Working Terms and Conditions (Annexure-I) and Non-Disclosure Agreement (Annexure-II) as per the joining rules and regulation. You will serve not less than 1 month of notice period when you decide to discontinue with your role at ${companyName}.`,
        `Your first salary will be credited after 45 days of working, 15 days salary will be hold for the security deposited, it will be settled with your last salary from company (FnF Settlement, 60 Days after Reliving).`,
        `This above offer is subject to yours being medically found fit and your document and background check being found satisfactory on verification. You should have your independent movement for performing your duties hence you are required to maintain own transportation.`,
        `Now therefore, you are requested to submit one set copies of the following documents to us at the time of your joining. You are also advised to bring originals along with the copies same will be returned immediately after our verification:`
    ];

    for (const para of paragraphs) {
        const lines = wrapText(para, fontRegular, 10.5, contentWidth);
        for (const line of lines) {
            page1.drawText(line, { x: margin, y, size: 10.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
            y -= 16.5;
        }
        y -= 15;
    }

    const docs = [
        "1. Educational certificates, 2 References.",
        "2. Four passport size color photographs.",
        "3. Two copies of Photo ID with Address Proof."
    ];
    for (const doc of docs) {
        page1.drawText(doc, { x: margin + 15, y, size: 10.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
        y -= 17;
    }

    // ──────────────────────────────────────────────
    // --- PAGE 2 ---
    // ──────────────────────────────────────────────
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);

    // Draw Watermark on Page 2 (Centered)
    if (embeddedLogo) {
        const wmDims = embeddedLogo.scaleToFit(pageWidth * 0.72, pageHeight * 0.42);
        page2.drawImage(embeddedLogo, {
            x: (pageWidth - wmDims.width) / 2,
            y: (pageHeight - wmDims.height) / 2,
            width: wmDims.width,
            height: wmDims.height,
            opacity: 0.13
        });
    }

    let y2 = pageHeight - margin - 35;

    const page2Paras = [
        "Please sign and return to the undersigned the duplicate copy of this letter signifying your acceptance.",
        `We welcome you to ${companyName} family and look forward to a fruitful collaboration. We are confident that your contribution will take us further in our journey towards becoming world leaders. We assure you of our support for your professional development and growth.`
    ];

    for (const para of page2Paras) {
        const lines = wrapText(para, fontRegular, 10.5, contentWidth);
        for (const line of lines) {
            page2.drawText(line, { x: margin, y: y2, size: 10.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
            y2 -= 16.5;
        }
        y2 -= 16;
    }

    y2 -= 25;
    page2.drawText("Best Regards,", { x: margin, y: y2, size: 10.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    y2 -= 24;
    page2.drawText("Manager - Human Resources", { x: margin, y: y2, size: 10.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
    y2 -= 18;
    page2.drawText(companyName, { x: margin, y: y2, size: 10.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

    y2 -= 60;
    page2.drawText(`I, ___________________________, accept the above offer and will begin the internship position on ${joinDate}.`, {
        x: margin,
        y: y2,
        size: 10.5,
        font: fontRegular,
        color: rgb(0.15, 0.15, 0.15)
    });

    y2 -= 55;
    page2.drawText("Signature_________________________.", {
        x: margin,
        y: y2,
        size: 10.5,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15)
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
};

/**
 * Universal Offer Letter PDF Generator Entry Point
 * Direct pdf-lib engine - zero Puppeteer/Chrome dependency
 */
export const generateOfferPdfBuffer = async (_html, data = {}) => {
    return await generateOfferPdfWithPdfLib(data);
};
