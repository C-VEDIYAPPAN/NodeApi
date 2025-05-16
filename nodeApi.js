import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { parseString } from "xml2js";
import js2xmlparser from "js2xmlparser";
import dotenv from "dotenv";
import fs from "fs";
import https from "https";

dotenv.config({ path: "./Config.env" });
const app = express();
const port = process.env.PORT || 8080; // Default to 8080 if PORT is not set

var MW_HEADER;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Health check endpoints --- //
app.get("/statusCheck", (req, res) => {
  res.status(400).json({ status: "ok" });
});

// Optional: Root endpoint for ALB health check if path is "/"
app.get("/", (req, res) => {
  res.status(400).json({ status: "ok" });
});

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
    const xml = js2xmlparser
      .parse(rootTag, innerJson)
      .replace(/<(\w+)([^>]*)\/>/g, "<$1$2></$1>");
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
    validateMWHeader(MW_HEADER);
    const soapEndpoint = process.env.APIURL;

    // Load certificates for mutual TLS
    const httpsAgent = new https.Agent({
      cert: fs.readFileSync(process.env.SERVERCERTIFICATE),
      key: fs.readFileSync(process.env.SERVERPRIVATEKEY),
      ca: fs.readFileSync(process.env.SERVERCRTCERTIFICATE),
      rejectUnauthorized: false,
    });

    console.log("[DEBUG] Sending API Request to:", soapEndpoint);

    const response = await axios.post(soapEndpoint, xmlRequest, {
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
      },
      httpsAgent,
      timeout: 10000,
    });

    console.log("[INFO] Certificate validation successful");

    console.log("[DEBUG] API Response Status:", response.status);
    console.log("[DEBUG] API Response Body:\n", response.data);

    if (!response.data) {
      console.error("[ERROR] Empty response from API service");
      return res.status(502).json({ error: "Empty response from API service" });
    }

    const jsonResult = await convertXmlToJson(response.data);
    const AfterHeaderAdd = {
      MW_HEADER,
      ...jsonResult,
    };

    console.log("[INFO] Successfully processed API request");
    res.status(200).json(AfterHeaderAdd);
  } catch (err) {
    // Print full error for debugging
    console.error("[ERROR] Exception caught:", err);

    // Detect certificate errors and print details
    if (
      err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      err.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      err.message.includes("self-signed certificate") ||
      err.message.includes("unable to verify the first certificate") ||
      err.message.includes("certificate") // catch generic certificate errors
    ) {
      console.error("[CERTIFICATE ERROR]", err.message);
      return res.status(502).json({
        error: "Certificate validation failed",
        message: err.message,
      });
    }

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
  console.log(
    `[INFO] Successfully HTTP Server is running at <=> http://localhost:${port}`
  );
});
