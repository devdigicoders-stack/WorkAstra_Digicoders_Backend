const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');

mongoose.connect('mongodb://localhost:27017/DigiCoders_HRMS').then(async () => {
    const db = mongoose.connection.db;
    
    // Find super_admin role
    const superAdminRole = await db.collection('roles').findOne({ name: 'super_admin' });
    if (!superAdminRole) {
        console.log("Super admin role not found");
        process.exit(1);
    }
    
    // Find an admin user
    const user = await db.collection('users').findOne({ role: superAdminRole._id });
    if (!user) {
        console.log("No super_admin user found");
        process.exit(1);
    }
    
    // Create token
    const token = jwt.sign({ 
        userId: user._id, 
        role: superAdminRole.name, 
        company: user.companyId ? user.companyId : null, 
        permissions: superAdminRole.permissions || [] 
    }, 'Tom_and_Jerry', { expiresIn: '1h' });
    
    console.log("Testing GET /api/assets...");
    try {
        const res = await axios.get('http://localhost:8008/api/assets', {
            headers: {
                Cookie: `token=${token}`
            }
        });
        console.log("STATUS:", res.status);
        console.log("DATA:", JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error("ERROR:", err.response ? err.response.data : err.message);
    }
    
    process.exit(0);
}).catch(console.error);
