import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import axios from "axios";

let browserPromise = null;

const CHROME_HINT =
    "Install Chrome for PDFs: cd server && npx puppeteer browsers install chrome";

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

    try {
        const bundled = puppeteer.executablePath();
        if (bundled && fs.existsSync(bundled)) return bundled;
    } catch {
        /* bundled browser not downloaded */
    }

    for (const candidate of systemChromePaths()) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
};

const launchOptions = () => {
    const executablePath = resolveChromeExecutable();
    if (!executablePath) {
        throw new Error(`Chrome/Chromium not found. ${CHROME_HINT}`);
    }
    return {
        headless: true,
        executablePath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    };
};

const getBrowser = async () => {
    if (!browserPromise) {
        browserPromise = puppeteer.launch(launchOptions()).catch((err) => {
            browserPromise = null;
            const detail = err?.message || String(err);
            throw new Error(`${detail}. ${CHROME_HINT}`);
        });
    }
    try {
        const browser = await browserPromise;
        if (!browser.connected) {
            browserPromise = null;
            return getBrowser();
        }
        return browser;
    } catch (err) {
        browserPromise = null;
        throw err;
    }
};

/**
 * Pure pdf-lib fallback generator (zero external browser or binary dependency, 100% reliable)
 */
export const generateOfferPdfWithPdfLib = async (data = {}) => {
    const {
        userName = "Employee",
        address = "Corporate Head Office - Lucknow",
        designation = "Developer",
        companyName = "DigiCoders Technologies Private Limited",
        ctc = "0",
        joinDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
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

    // --- PAGE 1 ---
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Embed Logo if available
    let logoEmbedded = false;
    if (logoUrl) {
        try {
            let imageBytes;
            if (logoUrl.startsWith("http")) {
                const resp = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
                imageBytes = resp.data;
            } else if (fs.existsSync(logoUrl)) {
                imageBytes = fs.readFileSync(logoUrl);
            }
            if (imageBytes) {
                let img;
                try {
                    img = await pdfDoc.embedPng(imageBytes);
                } catch (_) {
                    img = await pdfDoc.embedJpg(imageBytes);
                }
                if (img) {
                    const dims = img.scaleToFit(140, 50);
                    page1.drawImage(img, {
                        x: margin,
                        y: y - dims.height,
                        width: dims.width,
                        height: dims.height
                    });
                    y -= (dims.height + 20);
                    logoEmbedded = true;
                }
            }
        } catch (e) {
            console.warn("Logo embed warning:", e.message);
        }
    }

    if (!logoEmbedded) {
        page1.drawText(companyName.toUpperCase(), {
            x: margin,
            y,
            size: 15,
            font: fontBold,
            color: rgb(0.1, 0.2, 0.45)
        });
        y -= 25;
    }

    // Title: OFFER LETTER
    const titleText = "OFFER LETTER";
    const titleWidth = fontBold.widthOfTextAtSize(titleText, 14);
    page1.drawText(titleText, {
        x: (pageWidth - titleWidth) / 2,
        y,
        size: 14,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15)
    });
    page1.drawLine({
        start: { x: (pageWidth - titleWidth) / 2, y: y - 2 },
        end: { x: (pageWidth + titleWidth) / 2, y: y - 2 },
        thickness: 1,
        color: rgb(0.15, 0.15, 0.15)
    });
    y -= 30;

    // Metadata
    page1.drawText(`Dated: ${today}`, { x: margin, y, size: 9.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    y -= 15;
    page1.drawText(`Mr/Ms ${userName}`, { x: margin, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 14;
    page1.drawText(`B/o ${address}`, { x: margin, y, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    y -= 18;

    page1.drawText(`Dear ${userName},`, { x: margin, y, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;

    // Paragraphs
    const paragraphs = [
        `We are pleased to inform you that, with reference to your application and subsequent interview you had with us, we are pleased to offer you as a "${designation}" at our Corporate Head Office - Lucknow, on the terms and conditions discussed and agreed by you at the time of your interview. You are requested to join us on ${joinDate} as agreed by you. Your monthly remuneration will be ${ctc} INR and your work timings will be 10:00AM to 07:00PM, Monday to Saturday. You will be on probation period for first 3 months, after serving the probation period your performance and efforts will be reviewed to continue as permanent employee in ${companyName}. You will also get some incentive & increment for your Better Performance.`,
        `We will also review your performance and work every year and you will get benefits as per them. And your salary will be revised as per performance.`,
        `As per the acceptance of this offer letter, you will also accept the attached Working Terms and Conditions (Annexure-I) and Non-Disclosure Agreement (Annexure-II) as per the joining rules and regulation. You will serve not less than 1 month of notice period when you decide to discontinue with your role at ${companyName}.`,
        `Your first salary will be credited after 45 days of working, 15 days salary will be hold for the security deposited, it will be settled with your last salary from company (FnF Settlement, 60 Days after Relieving).`,
        `This above offer is subject to yours being medically found fit and your document and background check being found satisfactory on verification. You should have your independent movement for performing your duties hence you are required to maintain own transportation.`,
        `Now therefore, you are requested to submit one set copies of the following documents to us at the time of your joining. You are also advised to bring originals along with the copies same will be returned immediately after our verification:`
    ];

    for (const para of paragraphs) {
        const lines = wrapText(para, fontRegular, 9, contentWidth);
        for (const line of lines) {
            page1.drawText(line, { x: margin, y, size: 9, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
            y -= 13;
        }
        y -= 6;
    }

    const docs = [
        "1. Educational certificates, 2 References.",
        "2. Four passport size color photographs.",
        "3. Two copies of Photo ID with Address Proof."
    ];
    for (const doc of docs) {
        page1.drawText(doc, { x: margin + 15, y, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        y -= 13;
    }

    // --- PAGE 2 ---
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
    let y2 = pageHeight - margin - 30;

    page2.drawText(companyName.toUpperCase(), {
        x: margin,
        y: y2,
        size: 14,
        font: fontBold,
        color: rgb(0.1, 0.2, 0.45)
    });
    y2 -= 35;

    const page2Paras = [
        "Please sign and return to the undersigned the duplicate copy of this letter signifying your acceptance.",
        `We welcome you to ${companyName} family and look forward to a fruitful collaboration. We are confident that your contribution will take us further in our journey towards becoming world leaders. We assure you of our support for your professional development and growth.`
    ];

    for (const para of page2Paras) {
        const lines = wrapText(para, fontRegular, 9.5, contentWidth);
        for (const line of lines) {
            page2.drawText(line, { x: margin, y: y2, size: 9.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
            y2 -= 15;
        }
        y2 -= 10;
    }

    y2 -= 35;
    page2.drawText("Best Regards,", { x: margin, y: y2, size: 9.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    y2 -= 20;
    page2.drawText("Manager - Human Resources", { x: margin, y: y2, size: 9.5, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y2 -= 14;
    page2.drawText(companyName, { x: margin, y: y2, size: 9.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });

    y2 -= 70;
    page2.drawRectangle({
        x: margin,
        y: y2 - 40,
        width: contentWidth,
        height: 75,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 1,
        color: rgb(0.98, 0.98, 0.98)
    });

    page2.drawText(`I, ${userName}, accept the above offer and will begin my position on ${joinDate}.`, {
        x: margin + 15,
        y: y2 + 15,
        size: 9,
        font: fontRegular,
        color: rgb(0.1, 0.1, 0.1)
    });

    page2.drawText("Employee Signature: ___________________________       Date: _______________", {
        x: margin + 15,
        y: y2 - 18,
        size: 9,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2)
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
};

/**
 * Render offer letter to PDF buffer. Tries Puppeteer first, falls back seamlessly to pdf-lib.
 * @param {string} html
 * @param {object} [data]
 * @returns {Promise<Buffer>}
 */
export const generateOfferPdfBuffer = async (html, data = {}) => {
    try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
            await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
            await page.evaluate(async () => {
                if (document.fonts?.ready) await document.fonts.ready;
            });
            await new Promise((r) => setTimeout(r, 500));
            const pdf = await page.pdf({
                format: "A4",
                landscape: false,
                printBackground: true,
                margin: { top: "0", right: "0", bottom: "0", left: "0" },
            });
            return Buffer.from(pdf);
        } finally {
            await page.close();
        }
    } catch (err) {
        console.warn("Puppeteer offer letter generation failed, falling back to pdf-lib:", err.message);
        return await generateOfferPdfWithPdfLib(data);
    }
};
