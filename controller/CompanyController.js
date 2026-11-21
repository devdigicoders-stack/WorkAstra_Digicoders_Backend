import Company from "../models/CompanySchema.js"
import Role from "../models/roleSchema.js"
import User from "../models/UserSchema.js"
import bcrypt from "bcryptjs"
import { sendMail } from "../utills/SendEmail.js"
import { userCreatedTemplate } from "../utills/emailTemplates/userTemplate.js"
import { createNotification } from "../utills/notificationHelper.js"
import { uploadToCloudinary } from "../middleware/multer.js"

export const createCompany = async (req, res) => {
    try {
        const { name, address, domain, securityPin } = req.body
        const existingCompany = await Company.findOne({ domain })
        if (existingCompany) {
            if (existingCompany.isDeleted) {
                existingCompany.isDeleted = false
                existingCompany.name = name
                existingCompany.address = address
                existingCompany.createdBy = req.user.userId
                if (securityPin && securityPin.length === 6) {
                    existingCompany.securityPin = await bcrypt.hash(securityPin, 10);
                }
                await existingCompany.save()
                return res.status(200).json({ message: "Company restored successfully", company: existingCompany, success: true })
            }
            return res.status(400).json({ message: "Company with this domain already exists" })
        }

        const hashedPin = await bcrypt.hash(securityPin && securityPin.length === 6 ? securityPin : "706876", 10);
        const newCompany = new Company({
            name,
            address,
            domain,
            securityPin: hashedPin,
            createdBy: req.user.userId
        })
        await newCompany.save()
        res.status(201).json({ message: "Company created successfully", company: newCompany, success: true })

    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};

export const createCompanyWithAdmin = async (req, res) => {
    try {
        const {
            companyName,
            companyAddress,
            companyDomain,
            securityPin,
            adminFirstName,
            adminLastName,
            adminEmail,
            adminPhone,
            adminPassword,
        } = req.body;

        // Validate required fields
        if (!companyName || !companyDomain || !adminFirstName || !adminLastName || !adminEmail || !adminPhone || !adminPassword) {
            return res.status(400).json({ message: "All fields are required", success: false });
        }

        // Check if admin user already exists
        const existingUser = await User.findOne({ email: adminEmail });
        if (existingUser) {
            return res.status(400).json({ message: "Admin user already exists with this email", success: false });
        }

        // Check if company exists
        let company = await Company.findOne({ domain: companyDomain });
        const hashedPin = await bcrypt.hash(securityPin && securityPin.length === 6 ? securityPin : "706876", 10);

        if (company) {
            if (company.isDeleted) {
                // Restore soft-deleted company
                company.isDeleted = false;
                company.name = companyName;
                company.address = companyAddress;
                company.securityPin = hashedPin;
                company.createdBy = req.user.userId;
                await company.save();
            } else {
                return res.status(400).json({ message: "Company with this domain already exists", success: false });
            }
        } else {
            // Create new company
            company = new Company({
                name: companyName,
                address: companyAddress,
                domain: companyDomain,
                securityPin: hashedPin,
                createdBy: req.user.userId,
            });
            await company.save();
        }

        // Create Admin Role (if using a Role collection)
        let adminRole = await Role.findOne({ name: "admin", companyId: company._id });
        if (!adminRole) {
            adminRole = new Role({ name: "admin", companyId: company._id, permissions: ["Create_USER", "UPDATE_USER", "DELETE_USER", "VIEW_DEPARTMENT", "VIEW_USER", "VIEW_ALL_USERS", "Create_ROLE", "UPDATE_ROLE", "DELETE_ROLE", "VIEW_ROLE", "VIEW_ALL_ROLES", "VIEW_ALL_COMPLAINTS", "MANAGE_COMPLAINT", "CREATE_BRANCH", "UPDATE_BRANCH", "DELETE_BRANCH", "VIEW_BRANCH", "VIEW_ALL_BRANCHES", "MANAGE_BRANCH"] });
            await adminRole.save();
        }

        // Admin user existence check moved to top of function

        // Hash admin password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Create admin user
        const adminUser = new User({
            firstName: adminFirstName,
            lastName: adminLastName,
            email: adminEmail,
            phone: adminPhone,
            password: hashedPassword,
            role: adminRole._id,
            companyId: company._id,
            employeeCode: "ADMIN001", // default admin employee code
            joiningDate: new Date(),
            onboardingStatus: "approved"
        });
        await adminUser.save();

        // Send success response IMMEDIATELY
        res.status(201).json({
            message: "Company, Admin role, and Admin user created successfully",
            company,
            adminRole,
            adminUser,
            success: true,
        });

        // Background Task: Notifications and Emails (Does not block response)
        (async () => {
            try {
                await createNotification({
                    userId: adminUser._id,
                    title: "Welcome to DigiCoders Workastra! 🎉",
                    message: `Your company "${companyName}" has been set up. You are the admin. Login to get started.`,
                    type: "company",
                    link: "/",
                    createdBy: req.user.userId,
                });

                await sendMail({
                    email: adminEmail,
                    title: "Welcome to DigiCoders Workastra",
                    msg: userCreatedTemplate(adminUser, adminPassword),
                });
            } catch (backgroundError) {
                console.error("Error in background notification/email for new company:", backgroundError);
            }
        })();

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error", success: false });
    }
};

export const getCompanies = async (req, res) => {
    try {
        const user = req.user;
        if (user.role === "super_admin") {
            const companies = await Company.find({ isDeleted: false }).populate("createdBy", "firstName lastName email")
            return res.status(200).json({ companies, success: true })
        }
        const companies = await Company.find({ _id: user.company, isDeleted: false }).populate("createdBy", "firstName lastName email")
        res.status(200).json({ companies, success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};
export const getAllCompanies = async (req, res) => {
    try {
        const companies = await Company.find({ isDeleted: false })
            .populate("createdBy", "firstName lastName")
            .populate("updatedBy", "firstName lastName")
            .lean();
        const companiesWithAdmins = await Promise.all(
            companies.map(async (company) => {
                const adminRole = await Role.findOne({ name: "admin", companyId: company._id, });
                let admins = [];
                if (adminRole) {
                    admins = await User.find({
                        companyId: company._id,
                        role: adminRole._id,
                    }).select("firstName lastName email phone");
                }
                return {
                    ...company,
                    admins,
                };
            })
        );

        res.status(200).json({
            companies: companiesWithAdmins,
            success: true,
        });
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};

export const getCompanyById = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id).populate("createdBy", "firstName lastName email")
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false })
        }
        res.status(200).json({ company, success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};

export const updateCompany = async (req, res) => {
    try {
        const { name, address, domain } = req.body
        const company = await Company.findById(req.params.id).populate("createdBy", "firstName lastName email")
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false })
        }
        // admin can only update their own company
        if (req.user.role !== "super_admin" && company._id.toString() !== req.user.company?.toString()) {
            return res.status(403).json({ message: "Not allowed", success: false })
        }
        company.name = name || company.name
        company.address = address || company.address
        company.domain = domain || company.domain
        company.updatedBy = req.user.userId
        await company.save()
        res.status(200).json({ message: "Company updated successfully", company, success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};
export const updateCompanyWithAdmin = async (req, res) => {
    try {
        const {
            companyName,
            companyAddress,
            companyDomain,
            securityPin,
            adminFirstName,
            adminLastName,
            adminEmail,
            adminPhone,
            adminPassword,
        } = req.body;

        // 🔹 Validate required fields
        if (!companyName || !companyDomain || !adminFirstName || !adminLastName || !adminEmail || !adminPhone) {
            return res.status(400).json({ message: "All company and admin fields are required", success: false });
        }

        // 🔹 Find the company
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false });
        }

        // 🔹 Update company fields
        company.name = companyName;
        company.address = companyAddress;
        company.domain = companyDomain;

        let hashedPin = null;
        if (securityPin && String(securityPin).trim().length === 6) {
            hashedPin = await bcrypt.hash(String(securityPin).trim(), 10);
            company.securityPin = hashedPin;
        }

        await company.save();

        // 🔹 Find first admin of this company
        let adminRole = await Role.findOne({ name: { $regex: /^admin$/i }, companyId: company._id });
        let adminUser = await User.findOne({ companyId: company._id, role: adminRole?._id });

        // Fallback: find by email if role query didn't match
        if (!adminUser && adminEmail) {
            adminUser = await User.findOne({ email: adminEmail.toLowerCase() });
        }

        if (adminUser) {
            // Update admin fields
            adminUser.firstName = adminFirstName;
            adminUser.lastName = adminLastName;
            adminUser.email = adminEmail;
            adminUser.phone = adminPhone;

            // Only hash & update password if provided
            if (adminPassword && adminPassword.trim() !== "") {
                adminUser.password = await bcrypt.hash(adminPassword, 10);
            }

            // Sync securityPin if new PIN was provided
            if (hashedPin) {
                adminUser.securityPin = hashedPin;
            }

            await adminUser.save();
        }

        res.status(200).json({
            message: "Company and admin updated successfully",
            company,
            adminUser,
            success: true,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error", success: false });
    }
};

export const deleteCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id)
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false })
        }
        company.isDeleted = true
        await company.save()
        res.status(200).json({ message: "Company deleted successfully", success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};

export const restoreCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id).populate("createdBy", "firstName lastName email")
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false })
        }
        company.isDeleted = false
        await company.save()
        res.status(200).json({ message: "Company restored successfully", success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};

export const toggleCompanyStatus = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id)
        if (!company) {
            return res.status(404).json({ message: "Company not found", success: false })
        }
        company.status = !company.status
        await company.save()
        // Notify all users in the company
        const companyUsers = await User.find({ companyId: company._id }).select("_id");
        if (companyUsers.length) {
            await createNotification({
                userId: companyUsers.map(u => u._id),
                title: `Company ${company.status ? "Activated" : "Deactivated"}`,
                message: `Your company "${company.name}" has been ${company.status ? "activated" : "deactivated"}.`,
                type: "company",
                link: "/",
                createdBy: req.user.userId,
            });
        }
        res.status(200).json({ message: `Company ${company.status ? "activated" : "deactivated"} successfully`, success: true })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false })
    }
};


export const uploadCompanyIcon = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded", success: false });

        const company = await Company.findById(req.params.id);
        if (!company) return res.status(404).json({ message: "Company not found", success: false });

        if (req.user.role !== "super_admin" && company._id.toString() !== req.user.company?.toString())
            return res.status(403).json({ message: "Not allowed", success: false });

        const uploaded = await uploadToCloudinary(req.file, "digicoders/hrms/company-icons");
        company.icon = { url: uploaded.url, publicId: uploaded.publicId };
        company.updatedBy = req.user.userId;
        await company.save();

        res.json({ message: "Icon uploaded", company, success: true });
    } catch (error) {
        res.status(500).json({ message: "Internal server error", success: false });
    }
};

// PUT /api/company/change-pin
export const changeSecurityPin = async (req, res) => {
    try {
        const { currentPin, newPin } = req.body;
        if (!currentPin || !newPin || newPin.length !== 6) {
            return res.status(400).json({ success: false, message: "Valid current PIN and a new 6-digit PIN are required" });
        }

        const user = await User.findById(req.user.userId).populate("role");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // If Super Admin, allow updating their personal Security PIN in DB
        if (user.role?.name === "super_admin") {
            let isCurrentValid = false;
            if (user.securityPin) {
                isCurrentValid = await bcrypt.compare(currentPin, user.securityPin);
            } else if (process.env.SUPER_ADMIN_PAYROLL_PIN) {
                isCurrentValid = (currentPin === process.env.SUPER_ADMIN_PAYROLL_PIN);
            } else {
                isCurrentValid = (currentPin === "706876" || currentPin === "123456");
            }

            if (!isCurrentValid) {
                return res.status(400).json({ success: false, message: "Incorrect current PIN" });
            }

            user.securityPin = await bcrypt.hash(newPin, 10);
            await user.save();
            return res.json({ success: true, message: "Super Admin Security PIN updated successfully in database!" });
        }

        if (!user.companyId) {
            return res.status(400).json({ success: false, message: "User does not belong to any company" });
        }

        const company = await Company.findById(user.companyId);
        if (!company) return res.status(404).json({ success: false, message: "Company not found" });

        // Verify current PIN
        if (!company.securityPin) {
            return res.status(400).json({ success: false, message: "Company PIN is not set. Contact Super Admin." });
        }
        
        const isMatch = await bcrypt.compare(currentPin, company.securityPin);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Incorrect current PIN" });
        }

        // Hash and save new PIN
        const hashedPin = await bcrypt.hash(newPin, 10);
        company.securityPin = hashedPin;
        await company.save();

        user.securityPin = hashedPin;
        await user.save();

        res.json({ success: true, message: "Payroll Security PIN updated successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /api/company/:id/security-pin (Super Admin can set/reset any company's PIN)
export const superAdminSetCompanyPin = async (req, res) => {
    try {
        const { newPin } = req.body;
        if (!newPin || newPin.length !== 6) {
            return res.status(400).json({ success: false, message: "A valid 6-digit PIN is required" });
        }
        const company = await Company.findById(req.params.id);
        if (!company) return res.status(404).json({ success: false, message: "Company not found" });

        const hashedPin = await bcrypt.hash(newPin, 10);
        company.securityPin = hashedPin;
        await company.save();

        // Also sync all users belonging to this company
        await User.updateMany(
            { companyId: company._id },
            { $set: { securityPin: hashedPin } }
        );

        res.json({ success: true, message: `Security PIN for "${company.name}" updated successfully!` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
