import crypto from "crypto";

// Ensure a 32-byte (256-bit) buffer key from env or derive safely from JWT_SECRET
const getEncryptionKey = () => {
    const rawKey = process.env.PAYROLL_ENCRYPTION_KEY || (process.env.JWT_SECRET ? process.env.JWT_SECRET + "_WORKASTRA_PAYROLL_MASTER_KEY" : "WorkAstra_Default_Secure_Payroll_Key_2026");
    return crypto.createHash("sha256").update(String(rawKey)).digest();
};

/**
 * Encrypt a plain string or number into an authenticated AES-256-GCM ciphertext
 * Format: enc:ivHex:authTagHex:encryptedHex
 */
export const encryptField = (value) => {
    if (value === null || value === undefined || value === "") return value;
    
    // If already encrypted, return as is
    if (typeof value === "string" && value.startsWith("enc:")) return value;

    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

        const stringValue = String(value);
        let encrypted = cipher.update(stringValue, "utf8", "hex");
        encrypted += cipher.final("hex");

        const authTag = cipher.getAuthTag().toString("hex");
        const ivHex = iv.toString("hex");

        return `enc:${ivHex}:${authTag}:${encrypted}`;
    } catch (err) {
        console.error("Encryption error:", err.message);
        return value; // fallback safely
    }
};

/**
 * Decrypt an AES-256-GCM encrypted string back to its original value (or number)
 * Fully backward-compatible with unencrypted numbers/strings.
 */
export const decryptField = (value) => {
    if (value === null || value === undefined || value === "") return value;

    // Backward compatibility: If not starting with "enc:", it is plain data
    if (typeof value !== "string" || !value.startsWith("enc:")) {
        const num = Number(value);
        return !isNaN(num) && typeof value !== "boolean" ? num : value;
    }

    try {
        const parts = value.split(":");
        if (parts.length !== 4) return value; // Invalid format

        const [, ivHex, authTagHex, encryptedHex] = parts;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, "hex");
        const authTag = Buffer.from(authTagHex, "hex");

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, "hex", "utf8");
        decrypted += decipher.final("utf8");

        // Convert back to number if it was a numeric string
        const num = Number(decrypted);
        return !isNaN(num) && decrypted.trim() !== "" ? num : decrypted;
    } catch (err) {
        console.error("Decryption error:", err.message);
        return value;
    }
};

/**
 * Helper to encrypt a full payroll record's sensitive fields before saving to DB
 */
export const encryptPayrollRecord = (record) => {
    if (!record) return record;

    if (record.grossEarnings !== undefined) record.grossEarnings = encryptField(record.grossEarnings);
    if (record.netSalary !== undefined) record.netSalary = encryptField(record.netSalary);
    if (record.totalDeductions !== undefined) record.totalDeductions = encryptField(record.totalDeductions);
    if (record.lopDeduction !== undefined) record.lopDeduction = encryptField(record.lopDeduction);

    if (Array.isArray(record.components)) {
        record.components = record.components.map(comp => ({
            ...comp,
            amount: encryptField(comp.amount)
        }));
    }

    return record;
};

/**
 * Helper to decrypt a full payroll record's sensitive fields before sending to client
 */
export const decryptPayrollRecord = (record) => {
    if (!record) return record;

    const obj = record.toObject ? record.toObject() : { ...record };

    if (obj.grossEarnings !== undefined) obj.grossEarnings = decryptField(obj.grossEarnings);
    if (obj.netSalary !== undefined) obj.netSalary = decryptField(obj.netSalary);
    if (obj.totalDeductions !== undefined) obj.totalDeductions = decryptField(obj.totalDeductions);
    if (obj.lopDeduction !== undefined) obj.lopDeduction = decryptField(obj.lopDeduction);

    if (Array.isArray(obj.components)) {
        obj.components = obj.components.map(comp => ({
            ...comp,
            amount: decryptField(comp.amount)
        }));
    }

    return obj;
};

/**
 * Mask a payroll record when PIN is not verified
 */
export const maskPayrollRecord = (record) => {
    if (!record) return record;

    const obj = record.toObject ? record.toObject() : { ...record };

    obj.grossEarnings = "••••••";
    obj.netSalary = "••••••";
    obj.totalDeductions = "••••••";
    obj.lopDeduction = "••••••";

    if (Array.isArray(obj.components)) {
        obj.components = obj.components.map(comp => ({
            ...comp,
            amount: "••••••"
        }));
    }

    return obj;
};

/**
 * Helper to encrypt a full salary structure record's sensitive fields before saving to DB
 */
export const encryptSalaryStructure = (structure) => {
    if (!structure) return structure;

    const data = structure.toObject ? structure.toObject() : { ...structure };

    if (data.ctc !== undefined && data.ctc !== null) data.ctc = encryptField(data.ctc);
    if (data.basic !== undefined && data.basic !== null) data.basic = encryptField(data.basic);
    if (data.grossEarnings !== undefined && data.grossEarnings !== null) data.grossEarnings = encryptField(data.grossEarnings);
    if (data.totalDeductions !== undefined && data.totalDeductions !== null) data.totalDeductions = encryptField(data.totalDeductions);
    if (data.netSalary !== undefined && data.netSalary !== null) data.netSalary = encryptField(data.netSalary);

    if (Array.isArray(data.components)) {
        data.components = data.components.map(comp => ({
            ...comp,
            value: comp.value !== undefined && comp.value !== null ? encryptField(comp.value) : comp.value
        }));
    }

    if (structure.toObject) {
        structure.ctc = data.ctc;
        structure.basic = data.basic;
        structure.grossEarnings = data.grossEarnings;
        structure.totalDeductions = data.totalDeductions;
        structure.netSalary = data.netSalary;
        structure.components = data.components;
        return structure;
    }

    return data;
};

/**
 * Helper to decrypt a salary structure record's sensitive fields
 */
export const decryptSalaryStructure = (structure) => {
    if (!structure) return structure;

    const obj = structure.toObject ? structure.toObject() : { ...structure };

    if (obj.ctc !== undefined) obj.ctc = decryptField(obj.ctc);
    if (obj.basic !== undefined) obj.basic = decryptField(obj.basic);
    if (obj.grossEarnings !== undefined) obj.grossEarnings = decryptField(obj.grossEarnings);
    if (obj.totalDeductions !== undefined) obj.totalDeductions = decryptField(obj.totalDeductions);
    if (obj.netSalary !== undefined) obj.netSalary = decryptField(obj.netSalary);

    if (Array.isArray(obj.components)) {
        obj.components = obj.components.map(comp => ({
            ...comp,
            value: decryptField(comp.value)
        }));
    }

    return obj;
};

/**
 * Mask a salary structure record when PIN is not verified
 */
export const maskSalaryStructure = (structure) => {
    if (!structure) return structure;

    const obj = structure.toObject ? structure.toObject() : { ...structure };

    obj.ctc = "••••••";
    obj.basic = "••••••";
    obj.grossEarnings = "••••••";
    obj.totalDeductions = "••••••";
    obj.netSalary = "••••••";

    if (Array.isArray(obj.components)) {
        obj.components = obj.components.map(comp => ({
            ...comp,
            value: "••••••"
        }));
    }

    return obj;
};

/**
 * Helper to encrypt a payment record's sensitive fields before saving to DB
 */
export const encryptPaymentRecord = (payment) => {
    if (!payment) return payment;

    const data = payment.toObject ? payment.toObject() : { ...payment };

    if (data.amount !== undefined && data.amount !== null) data.amount = encryptField(data.amount);
    if (data.transactionId !== undefined && data.transactionId !== null) data.transactionId = encryptField(data.transactionId);

    if (payment.toObject) {
        payment.amount = data.amount;
        payment.transactionId = data.transactionId;
        return payment;
    }

    return data;
};

/**
 * Helper to decrypt a payment record's sensitive fields before returning to client
 */
export const decryptPaymentRecord = (payment) => {
    if (!payment) return payment;

    const obj = payment.toObject ? payment.toObject() : { ...payment };

    if (obj.amount !== undefined) obj.amount = decryptField(obj.amount);
    if (obj.transactionId !== undefined) obj.transactionId = decryptField(obj.transactionId);

    if (obj.projectId && typeof obj.projectId === "object") {
        if (obj.projectId.price !== undefined) obj.projectId.price = decryptField(obj.projectId.price);
        if (obj.projectId.receivedAmount !== undefined) obj.projectId.receivedAmount = decryptField(obj.projectId.receivedAmount);
    }

    return obj;
};

/**
 * Helper to encrypt a project record's sensitive finance fields before saving to DB
 */
export const encryptProjectRecord = (project) => {
    if (!project) return project;

    const data = project.toObject ? project.toObject() : { ...project };

    if (data.price !== undefined && data.price !== null) data.price = encryptField(data.price);
    if (data.receivedAmount !== undefined && data.receivedAmount !== null) data.receivedAmount = encryptField(data.receivedAmount);

    if (project.toObject) {
        project.price = data.price;
        project.receivedAmount = data.receivedAmount;
        return project;
    }

    return data;
};

/**
 * Helper to decrypt a project record's sensitive finance fields before returning to client
 */
export const decryptProjectRecord = (project) => {
    if (!project) return project;

    const obj = project.toObject ? project.toObject() : { ...project };

    if (obj.price !== undefined) obj.price = decryptField(obj.price);
    if (obj.receivedAmount !== undefined) obj.receivedAmount = decryptField(obj.receivedAmount);

    return obj;
};
