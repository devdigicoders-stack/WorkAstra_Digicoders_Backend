import mongoose from "mongoose";

const ndaSignatureSchema = new mongoose.Schema({
  ndaId: { type: mongoose.Schema.Types.ObjectId, ref: "Nda" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  signatureBase64: { type: String, required: true },
  signedDocumentUrl: { type: String }, // Store the stamped PDF URL
  employeeDetails: {
    fullName: { type: String },
    fatherName: { type: String },
    employeeId: { type: String },
    designation: { type: String },
    phone: { type: String },
    email: { type: String },
    address: { type: String }
  },
  witnessDetails: {
    fullName: { type: String },
    address: { type: String },
    phone: { type: String },
    role: { type: String },
    signatureBase64: { type: String }
  },
  signedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const NdaSignatureModel = mongoose.model("NdaSignature", ndaSignatureSchema);
export default NdaSignatureModel;
