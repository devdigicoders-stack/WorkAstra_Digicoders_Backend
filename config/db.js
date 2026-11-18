import mongoose from "mongoose";
import EnvData from "./EnvData.js";

const connectdb = async () => {
    try {
        let databaseURL;

        if (EnvData.NODE_ENV === 'development') {
            databaseURL = EnvData.MONGO_URI_DEV;
            console.log("🛠️ Using Development Database");
        } else {
            databaseURL = EnvData.MONGO_URI_PROD;
            console.log("🚀 Using Production/Working Database");
        }

        const conn = await mongoose.connect(databaseURL)
        console.log("Mongo DB Connected Successfully!", conn.connection.host)
    } catch (error) {
        console.log("Mongo DB Connection Failed", error)
    }
}

export default connectdb