import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getBase64Image = (filename) => {
    try {
        const filePath = path.join(__dirname, '..', '..', 'client', 'public', filename);
        if (fs.existsSync(filePath)) {
            const bitmap = fs.readFileSync(filePath);
            return `data:image/png;base64,${bitmap.toString('base64')}`;
        }
    } catch (e) { console.error('Error reading image', e); }
    return null;
};

export const generateExperienceLetterPDF = async (user, resignation) => {
    // Determine dates
    const startDate = user.joiningDate ? new Date(user.joiningDate) : new Date();
    const endDate = resignation.approvedLastWorkingDay ? new Date(resignation.approvedLastWorkingDay) : (resignation.requestedLastWorkingDay ? new Date(resignation.requestedLastWorkingDay) : new Date());

    // Format dates to DD-Month-YYYY
    const formatDate = (date) => {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = d.toLocaleString('en-US', { month: 'long' });
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    // Calculate duration in months
    let months = (endDate.getFullYear() - startDate.getFullYear()) * 12;
    months -= startDate.getMonth();
    months += endDate.getMonth();
    if (months <= 0) months = 1; // Minimum 1 month

    let durationText = `${months < 10 ? '0' + months : months} months`;
    if (months >= 12) {
        const years = Math.floor(months / 12);
        const remainingMonths = months % 12;
        if (remainingMonths === 0) {
            durationText = `${years < 10 ? '0' + years : years} years`;
        } else {
            durationText = `${years < 10 ? '0' + years : years} years and ${remainingMonths < 10 ? '0' + remainingMonths : remainingMonths} months`;
        }
    }

    const employeeName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const designation = user.designation?.name || user.role?.name || 'Employee';
    const companyName = user.companyId?.name || 'DigiCoders Technologies Private Limited';

    const stampImage = getBase64Image('stamp.png');
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                @page { margin: 0; }
                body {
                    font-family: Arial, sans-serif;
                    color: #000;
                    margin: 0;
                    padding: 0;
                }
                .page {
                    padding: 60px 80px;
                    box-sizing: border-box;
                    min-height: 100vh;
                    position: relative;
                }
                .logo-container {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .logo-text {
                    font-size: 28px;
                    font-weight: bold;
                }
                .logo-digi { color: #000; }
                .logo-coders { color: #11b2b8; }
                .header {
                    text-align: center;
                    font-size: 18px;
                    font-weight: bold;
                    margin-bottom: 30px;
                    text-decoration: underline;
                }
                .content {
                    text-align: justify;
                }
                .content p {
                    margin-bottom: 20px;
                }
                .bold {
                    font-weight: bold;
                }
                .details-section {
                    margin-top: 30px;
                }
                .details-section p {
                    margin-bottom: 5px;
                }
                .signature-section {
                    margin-top: 35px;
                    display: flex;
                    justify-content: flex-end;
                    text-align: right;
                    position: relative;
                }
                .signature-box {
                    text-align: center;
                    width: 250px;
                }
                .stamp-placeholder {
                    width: 120px;
                    height: 120px;
                    border: 2px solid #555;
                    border-radius: 50%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    color: #555;
                    font-weight: bold;
                    font-size: 12px;
                    transform: rotate(-15deg);
                    margin-bottom: 10px;
                    text-align: center;
                    line-height: 1.3;
                    opacity: 0.7;
                }
                .manager-name {
                    font-weight: bold;
                    font-size: 15px;
                    margin-bottom: 5px;
                    margin-top: 5px;
                }
                .manager-title {
                    font-weight: bold;
                    font-size: 15px;
                }
            </style>
        </head>
        <body>
            <div class="page">
                <div class="logo-container">
                    ${(() => {
                        const companyLogoUrl = user.companyId?.icon?.url;
                        const localLogo = getBase64Image('logo1.png') || getBase64Image('DigiCoders Transparent Logo (2).png');
                        if (companyLogoUrl) {
                            return `<img src="${companyLogoUrl}" style="height: 50px; margin-bottom: 10px; object-fit: contain;" />`;
                        } else if (localLogo) {
                            return `<img src="${localLogo}" style="height: 50px; margin-bottom: 10px; object-fit: contain;" />`;
                        } else {
                            return `<div class="logo-text">
                                 <span class="logo-digi">${companyName.split(' ')[0]}</span><span class="logo-coders">{Company}</span>
                               </div>`;
                        }
                    })()}
                </div>
                <div class="header">
                    Experience Letter
                </div>
                <div class="content">
                    <p>This is to certify that <span class="bold">${employeeName}</span>, has worked as <span class="bold">${designation}</span> with this company for the period of <span class="bold">${durationText}</span> from <span class="bold">${formattedStartDate}</span> to <span class="bold">${formattedEndDate}</span>.</p>
                
                <p>During his tenure she/he was responsible for monitoring day to day functions of the Project, supervising and guiding the project team, monitoring and evaluating the progress. She/he was actively involved in the day-to-day administration of the activities, appraisal of team performance, coordinating and managing the overall performance of the team. She/he was also responsible for managing the Projects and Supervised the Complete Project. Her/his technical skill and performance is to the best of our satisfaction.</p>
                
                <p>We are sure she/he will perform her/his duties with this experience in her/his future jobs and we are happy to recommend her/him for any responsible position in relevant field. We wish her/him all the best.</p>
                
                <div class="details-section">
                    Company Name – ${companyName}<br>
                    Designation – ${designation}
                </div>
                
                <div class="details-section">
                    Experience:<br>
                    Start date – ${formattedStartDate}<br>
                    End Date – ${formattedEndDate}
                </div>
            </div>
            
            <div class="signature-section">
                <div class="signature-box">
                    ${
                        getBase64Image('themas.png')
                            ? `<img src="${getBase64Image('themas.png')}" style="width: 180px; height: auto; margin-bottom: 0px; object-fit: contain;" />`
                            : `<div class="stamp-placeholder">
                                ${companyName.replace(/ /g, '<br>')}<br>(Placeholder)
                               </div>`
                    }
                    <div class="manager-name">Mr. Himanshu Kashyap</div>
                    <div class="manager-title">Manager</div>
                </div>
            </div>
        </div>
        </body>
        </html>
    `;

    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true
    });

    await browser.close();

    return pdfBuffer;
};
