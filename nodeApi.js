import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parseString } from "xml2js";
import js2xmlparser from "js2xmlparser";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config({ path: "./Config.env" });
const app = express();
const port = 3000; // Use a non-privileged port for HTTP

var MW_HEADER;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuration for encryption/decryption
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

function encrypt(text) {
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

// Utility: Decrypt data
function decrypt(text) {
  let textParts = text.split(":");
  let iv = Buffer.from(textParts.shift(), "hex");
  let encryptedText = Buffer.from(textParts.join(":"), "hex");
  let decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// Middleware to check for authorization token (now expecting an encrypted token)
function checkAuthToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const encryptedToken = authHeader.split(" ")[1];
    try {
      const decryptedToken = decrypt(encryptedToken);
      if (decryptedToken === process.env.AUTH_TOKEN) {
        return next();
      } else {
        console.warn(
          "[WARN] Authentication failed: Decrypted token does not match."
        );
        return res.status(403).json({ error: "Forbidden: Invalid token" });
      }
    } catch (error) {
      console.error("[ERROR] Error decrypting token:", error.message);
      return res.status(403).json({ error: "Forbidden: Invalid token format" });
    }
  }
  res.status(403).json({ error: "Forbidden: Missing or invalid token format" });
}

// Apply the middleware to all routes
app.use(checkAuthToken);

// Utility: Validate request body
function validateRequestBody(body) {
  const isValid =
    body && typeof body === "object" && Object.keys(body).length > 0;
  console.log("[DEBUG] Request Body Valid:", isValid);
  return isValid;
}

// Utility: Convert JSON to XML
function convertJsonToXml(json) {
  try {
    const MwHeader = Object.keys(json)[0];
    MW_HEADER = json[MwHeader];
    const rootTag = Object.keys(json)[1];
    console.log("[DEBUG] Root tag:\n", rootTag);
    const innerJson = json[rootTag];
    const xml = js2xmlparser.parse(rootTag, innerJson);
    console.log("[DEBUG] Converted JSON to XML:\n", xml);
    return xml;
  } catch (err) {
    console.error("[ERROR] JSON to XML conversion failed:", err.message);
    throw new Error("Failed to convert JSON to XML");
  }
}

// Validate the header has all the required parameters
function validateMWHeader(mwHeader) {
  const requiredFields = ["SessionID", "ServiceName", "RequestTime"];
  const missingFields = requiredFields.filter(
    (field) => !mwHeader[field] || mwHeader[field] === null
  );

  if (missingFields.length > 0) {
    console.error("[ERROR] Missing required MW_HEADER fields:", missingFields);
    throw new Error(
      `Missing required MW_HEADER fields: ${missingFields.join(", ")}`
    );
  }
  console.log("[DEBUG] MW_HEADER validation passed");
}

// Utility: Convert XML to JSON
function convertXmlToJson(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) {
        console.error("[ERROR] Failed to parse XML to JSON:", err.message);
        return reject(new Error("Failed to parse XML response"));
      }
      console.log("[DEBUG] Parsed XML to JSON:", result);
      resolve(result);
    });
  });
}

// Call API here
app.post("/RestApi-call", async (req, res) => {
  console.log("\n[INFO] Incoming Request Received");
  try {
    if (!validateRequestBody(req.body)) {
      console.warn("[WARN] Invalid or empty JSON body");
      return res.status(400).json({ error: "Invalid or empty JSON body" });
    }

    const xmlRequest = convertJsonToXml(req.body);
    // Validate the middleware header
    validateMWHeader(MW_HEADER);
    const soapEndpoint = process.env.APIURL;

    // No https.Agent needed for outgoing requests unless the target endpoint requires client certs.
    // If you need to call an HTTPS endpoint with client certs, you can still use https.Agent here.

    console.log("[DEBUG] Sending API Request to:", soapEndpoint);

    const response = await axios.post(soapEndpoint, xmlRequest, {
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
      },
      timeout: 10000,
      // httpsAgent: httpsAgent, // Only needed if the SOAP endpoint requires SSL client certs
    });

    console.log("[DEBUG] API Response Status:", response.status);
    console.log("[DEBUG] API Response Body:\n", response.data);

    if (!response.data) {
      console.error("[ERROR] Empty response from API service");
      return res.status(502).json({ error: "Empty response from API service" });
    }

    // Convert XML to JSON
    const jsonResult = await convertXmlToJson(response.data);
    const AfterHeaderAdd = {
      MW_HEADER,
      ...jsonResult,
    };

    console.log("[INFO] Successfully processed API request");
    res.status(200).json(AfterHeaderAdd);
  } catch (err) {
    console.error("[ERROR] Exception caught:", err.message);

    if (axios.isAxiosError(err)) {
      console.error("[ERROR] Axios Error Response:", err.response?.data);
      return res.status(502).json({
        error: "API service call failed",
        message: err.response?.data || err.message,
      });
    }

    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
});

// Start HTTP server
app.listen(port, () => {
  console.log(`[INFO] HTTP Server is running at http://localhost:${port}`);
});
