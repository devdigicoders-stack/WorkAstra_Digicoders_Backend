import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getBase64Image = (filename) => {
    try {
        // Look in client/public
        const filePath = path.join(__dirname, '..', '..', 'client', 'public', filename);
        if (fs.existsSync(filePath)) {
            const bitmap = fs.readFileSync(filePath);
            return `data:image/png;base64,${bitmap.toString('base64')}`;
        }
    } catch (e) { 
        console.error('Error reading image', e); 
    }
    return null;
};

const numberToWords = (num) => {
    const a = ['', 'one ', 'two ', 'three ', 'four ', 'five ', 'six ', 'seven ', 'eight ', 'nine ', 'ten ', 'eleven ', 'twelve ', 'thirteen ', 'fourteen ', 'fifteen ', 'sixteen ', 'seventeen ', 'eighteen ', 'nineteen '];
    const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    if ((num = num.toString()).length > 9) return 'overflow';
    const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return ''; 
    let str = '';
    str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'crore ' : '';
    str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'lakh ' : '';
    str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'thousand ' : '';
    str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'hundred ' : '';
    str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
    return str.trim();
};

export const generateSalarySlipsPDF = async (user, runs) => {
    const employeeName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const employeeId = user.employeeCode || 'N/A';
    const designation = user.designation?.name || user.role?.name || 'Employee';
    const companyName = user.companyId?.name || 'DigiCoders Technologies Pvt. Ltd.';

    let htmlContent = `
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
                    page-break-after: always;
                    min-height: 100vh;
                    position: relative;
                }
                .page:last-child {
                    page-break-after: auto;
                }
                .logo-container {
                    text-align: center;
                    margin-bottom: 10px;
                }
                .logo-text {
                    font-size: 28px;
                    font-weight: bold;
                }
                .logo-digi { color: #000; }
                .logo-coders { color: #11b2b8; }
                .subtitle {
                    text-align: center;
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 30px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 25px;
                    font-size: 13px;
                }
                th, td {
                    border: 1px solid #000;
                    padding: 9px 10px;
                    text-align: left;
                }
                th {
                    background-color: #fff;
                    font-weight: bold;
                }
                .header-cell {
                    width: 40%;
                }
                .bold { font-weight: bold; }
                .amount-cell {
                    text-align: left;
                }
                .signature-section {
                    margin-top: 40px;
                    display: flex;
                    justify-content: flex-end;
                    text-align: center;
                    padding-right: 20px;
                }
                .signature-box {
                    width: 200px;
                }
                .stamp-placeholder {
                    width: 100px;
                    height: 100px;
                    border: 2px solid #555;
                    border-radius: 50%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    color: #555;
                    font-weight: bold;
                    font-size: 11px;
                    transform: rotate(-15deg);
                    margin: 0 auto 10px auto;
                    text-align: center;
                    line-height: 1.3;
                    opacity: 0.7;
                }
                .manager-title {
                    font-weight: bold;
                    font-size: 14px;
                }
                .text-capitalize { text-transform: capitalize; }
            </style>
        </head>
        <body>
    `;

    for (const run of runs) {
        // Parse month (YYYY-MM to full month name + year)
        const [year, monthStr] = run.month.split('-');
        const dateObj = new Date(year, Number(monthStr) - 1);
        const monthName = dateObj.toLocaleString('en-US', { month: 'long' });
        const displayMonthYear = `${monthName} ${year}`;
        const shortDisplayMonthYear = `${monthName}-${year}`;

        // Standard components we want to show
        const earnings = run.components?.filter(c => c.type === 'earning') || [];
        const deductions = run.components?.filter(c => c.type === 'deduction') || [];

        const getComponentAmount = (arr, nameKeywords) => {
            const comp = arr.find(c => nameKeywords.some(kw => c.name.toLowerCase().includes(kw)));
            return comp ? comp.amount.toFixed(2) : 'NA';
        };

        const basic = getComponentAmount(earnings, ['basic']);
        const hra = getComponentAmount(earnings, ['hra', 'house rent']);
        const conveyance = getComponentAmount(earnings, ['conveyance', 'transport']);
        const medical = getComponentAmount(earnings, ['medical']);
        const special = getComponentAmount(earnings, ['special']);
        const incentives = getComponentAmount(earnings, ['incentive', 'bonus']);
        
        const grossEarningsStr = run.grossEarnings > 0 ? run.grossEarnings.toFixed(2) : '0.00';
        const totalDeductionsStr = run.totalDeductions > 0 ? run.totalDeductions.toFixed(2) : '0.00';
        const netSalaryStr = run.netSalary > 0 ? run.netSalary.toFixed(2) : '0.00';
        
        const words = numberToWords(Math.floor(run.netSalary));
        const netSalaryWords = words ? `${words.charAt(0).toUpperCase() + words.slice(1)} Rupees Only/-` : 'Zero Rupees Only/-';

        const companyLogoUrl = user.companyId?.icon?.url;
        const localLogo = getBase64Image('logo1.png') || getBase64Image('DigiCoders Transparent Logo (2).png');
        
        let logoHtml = '';
        if (companyLogoUrl) {
            logoHtml = `<img src="${companyLogoUrl}" style="height: 50px; margin-bottom: 10px; object-fit: contain;" />`;
        } else if (localLogo) {
            logoHtml = `<img src="${localLogo}" style="height: 50px; margin-bottom: 10px; object-fit: contain;" />`;
        } else {
            logoHtml = `<div class="logo-text">
                 <span class="logo-digi">${companyName.split(' ')[0]}</span><span class="logo-coders">{Company}</span>
               </div>`;
        }

        const stampImage = getBase64Image('themas.png');
               
        const stampHtml = stampImage
            ? `<img src="${stampImage}" style="width: 180px; height: auto; margin-bottom: 0px; object-fit: contain;" />`
            : `<div class="stamp-placeholder">
                   ${companyName.replace(/ /g, '<br>')}<br>(Placeholder)
               </div>`;

        htmlContent += `
            <div class="page">
                <div class="logo-container">
                    ${logoHtml}
                </div>
                
                <div class="subtitle">Pay Slip for the Month – ${displayMonthYear}</div>
                
                <table>
                    <tbody>
                        <tr>
                            <td class="header-cell">Name of the Employee</td>
                            <td class="bold">${employeeName}</td>
                        </tr>
                        <tr>
                            <td>Employee ID</td>
                            <td class="bold">${employeeId}</td>
                        </tr>
                        <tr>
                            <td>Designation</td>
                            <td class="bold">${designation}</td>
                        </tr>
                        <tr>
                            <td>Salary for the month of</td>
                            <td class="bold">${shortDisplayMonthYear}</td>
                        </tr>
                    </tbody>
                </table>
                
                <table>
                    <thead>
                        <tr>
                            <th style="width: 35%;">Particulars</th>
                            <th style="width: 25%;">Gross Salary</th>
                            <th style="width: 20%;">Earnings</th>
                            <th style="width: 20%;">Deductions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="bold">Basic</td>
                            <td class="amount-cell">${grossEarningsStr}</td>
                            <td class="amount-cell">${basic !== 'NA' ? basic : grossEarningsStr}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">HRA</td>
                            <td></td>
                            <td class="amount-cell">${hra}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">Conveyance Allowance</td>
                            <td></td>
                            <td class="amount-cell">${conveyance}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">Medical Allowance</td>
                            <td></td>
                            <td class="amount-cell">${medical}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">Special Allowance</td>
                            <td></td>
                            <td class="amount-cell">${special}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">Incentives</td>
                            <td></td>
                            <td class="amount-cell">${incentives}</td>
                            <td class="amount-cell">NA</td>
                        </tr>
                        <tr>
                            <td class="bold">Amount in Rs</td>
                            <td class="amount-cell">${grossEarningsStr}</td>
                            <td class="amount-cell">${grossEarningsStr}</td>
                            <td class="amount-cell">${totalDeductionsStr}</td>
                        </tr>
                        <tr>
                            <td colspan="3" style="text-align: right;" class="bold">Net Salary</td>
                            <td class="bold">${netSalaryStr} INR</td>
                        </tr>
                        <tr>
                            <td colspan="4" style="text-align: center;" class="bold text-capitalize">Net Salary: ${netSalaryWords}</td>
                        </tr>
                    </tbody>
                </table>
                
                <div class="signature-section">
                    <div class="signature-box">
                        ${stampHtml}
                        <div class="manager-title">Authorized Signatory</div>
                    </div>
                </div>
            </div>
        `;
    }

    htmlContent += `
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
