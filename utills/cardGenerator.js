import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const generateGreetingCard = async (user, type = 'birthday') => {
    try {
        const year = new Date().getFullYear();
        const fileName = `${user._id}_${type}_${year}.png`;
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'wishes');
        const outputPath = path.join(uploadsDir, fileName);

        // Ensure directory exists
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // If already generated this year, return it
        if (fs.existsSync(outputPath)) {
            return `/uploads/wishes/${fileName}`;
        }

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        // Read template image and convert to Base64 to ensure Puppeteer can always load it
        let templateFileName = type === 'anniversary' ? 'anniversary_template.png' : 'birthday_template.png';
        let templatePath = path.join(__dirname, '..', 'uploads', 'templates', templateFileName);
        
        // Fallback to birthday template if anniversary template doesn't exist
        if (!fs.existsSync(templatePath)) {
            templateFileName = 'birthday_template.png';
            templatePath = path.join(__dirname, '..', 'uploads', 'templates', templateFileName);
        }

        let templateBase64 = '';
        if (fs.existsSync(templatePath)) {
            const templateBuffer = fs.readFileSync(templatePath);
            templateBase64 = `data:image/png;base64,${templateBuffer.toString('base64')}`;
        }

        // Default avatar if no profile pic
        let profilePicUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.firstName + ' ' + user.lastName) + '&background=random&size=300';
        if (user.profilePic && typeof user.profilePic === 'string' && user.profilePic.startsWith('http')) {
            profilePicUrl = user.profilePic;
        } else if (user.profilePic && user.profilePic.url) {
            profilePicUrl = user.profilePic.url;
        }

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        width: 1200px;
                        height: 800px;
                        background-image: url('${templateBase64}');
                        background-size: cover;
                        background-position: center;
                        background-repeat: no-repeat;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        position: relative;
                    }
                    /* Container for the text on the left */
                    .text-container {
                        position: absolute;
                        top: 200px;
                        left: 120px;
                        width: 450px;
                        text-align: center;
                    }
                    .greeting {
                        font-size: ${type === 'anniversary' ? '42px' : '50px'};
                        font-weight: 900;
                        color: #2e7d32; /* Green matching the cake */
                        margin-bottom: 20px;
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
                    }
                    .name {
                        font-size: 40px;
                        font-weight: bold;
                        color: #1b5e20;
                    }
                    /* Profile picture circle on the right */
                    .profile-pic-container {
                        position: absolute;
                        top: 122px;
                        right: 182px;
                        width: 315px;
                        height: 315px;
                        border-radius: 50%;
                        overflow: hidden;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .profile-pic {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }
                </style>
            </head>
            <body>
                <div class="text-container">
                    <div class="greeting">${type === 'birthday' ? 'Happy Birthday!' : 'Work Anniversary!'}</div>
                    <div class="name">${user.firstName} ${user.lastName}</div>
                </div>
                <div class="profile-pic-container">
                    <img class="profile-pic" src="${profilePicUrl}" />
                </div>
            </body>
            </html>
        `;

        await page.setContent(htmlContent, { waitUntil: 'load', timeout: 15000 });

        // Wait a bit extra for images to render
        await new Promise(r => setTimeout(r, 2000));

        await page.screenshot({ path: outputPath, type: 'png' });
        await browser.close();

        return `/uploads/wishes/${fileName}`;
    } catch (error) {
        console.error("Error generating greeting card:", error);
        return null;
    }
};
