import multer from "multer";
import path from "path";
import fs from "fs";

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        // create a clean filename
        cb(null, file.fieldname + '-' + uniqueSuffix + '.' + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },  // 50 MB
});

export const uploadToCloudinary = async (file, folder = "local") => {
    // The file is already saved by multer diskStorage
    // Store only relative path — frontend will prepend VITE_BASE_URL
    return {
        name: file.originalname,
        url: `/uploads/${file.filename}`,
        publicId: file.filename,
        resourceType: "local",
    };
};

export const uploadManyToCloudinary = (files = [], folder) =>
    Promise.all(files.map(f => uploadToCloudinary(f, folder)));

export const uploadBufferToCloudinary = async (buffer, mimetype, filename, folder = "local") => {
    const ext = filename.split('.').pop() || "bin";
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const localFileName = `buffer-${uniqueSuffix}.${ext}`;
    const filePath = path.join(uploadDir, localFileName);

    fs.writeFileSync(filePath, buffer);

    // Store only relative path — frontend will prepend VITE_BASE_URL
    return {
        url: `/uploads/${localFileName}`,
        publicId: localFileName,
    };
};

export default upload;
