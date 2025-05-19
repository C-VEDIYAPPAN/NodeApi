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

// --- JSON Logger Utility --- //
function log(level, message, extra = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  console.log(JSON.stringify(logEntry));
}

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
  log("DEBUG", "Request Body Valid", { isValid });
  return isValid;
}

// Utility: Convert JSON to XML
function convertJsonToXml(json) {
  try {
    const MwHeader = Object.keys(json)[0];
    MW_HEADER = json[MwHeader];
    const rootTag = Object.keys(json)[1];
    log("DEBUG", "Root tag", { rootTag });
    const innerJson = json[rootTag];
    const xml = js2xmlparser
      .parse(rootTag, innerJson)
      .replace(/<(\w+)([^>]*)\/>/g, "<$1$2></$1>");
    log("DEBUG", "Converted JSON to XML", { xml });
    return xml;
  } catch (err) {
    log("ERROR", "JSON to XML conversion failed", { error: err.message });
    throw new Error(
      "Failed to convert JSON to XML (or) Missing Middle Ware Header"
    );
  }
}

// Validate the header has all the required parameters
function validateMWHeader(mwHeader) {
  const requiredFields = ["SessionID", "ServiceName", "RequestTime"];
  const missingFields = requiredFields.filter(
    (field) => !mwHeader[field] || mwHeader[field] === null
  );

  if (missingFields.length > 0) {
    log("ERROR", "Missing required MW_HEADER fields", { missingFields });
    throw new Error(
      `Missing required MW_HEADER fields: ${missingFields.join(", ")}`
    );
  }
  log("DEBUG", "MW_HEADER validation passed");
}

// Utility: Convert XML to JSON
function convertXmlToJson(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) {
        log("ERROR", "Failed to parse XML to JSON", { error: err.message });
        return reject(new Error("Failed to parse XML response"));
      }
      log("DEBUG", "Parsed XML to JSON", { result });
      resolve(result);
    });
  });
}

// Call API here
app.post("/RestApi-call", async (req, res) => {
  log("INFO", "Incoming Request Received");
  try {
    if (!validateRequestBody(req.body)) {
      log("WARN", "Invalid or empty JSON body");
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

    log("DEBUG", "Sending API Request", { soapEndpoint });

    const response = await axios.post(soapEndpoint, xmlRequest, {
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
      },
      httpsAgent,
      timeout: 10000,
    });

    log("INFO", "Certificate validation successful");

    log("DEBUG", "API Response", {
      status: response.status,
      body: response.data,
    });

    if (!response.data) {
      log("ERROR", "Empty response from API service");
      return res.status(502).json({ error: "Empty response from API service" });
    }

    const jsonResult = await convertXmlToJson(response.data);
    const AfterHeaderAdd = {
      MW_HEADER,
      ...jsonResult,
    };

    log("INFO", "Successfully processed API request");
    res.status(200).json(AfterHeaderAdd);
  } catch (err) {
    log("ERROR", "Exception caught", { error: err.message, stack: err.stack });

    // Detect certificate errors and print details
    if (
      err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      err.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      (err.message &&
        (err.message.includes("self-signed certificate") ||
          err.message.includes("unable to verify the first certificate") ||
          err.message.includes("certificate")))
    ) {
      log("ERROR", "Certificate validation failed", { error: err.message });
      return res.status(502).json({
        error: "Certificate validation failed",
        message: err.message,
      });
    }

    if (axios.isAxiosError(err)) {
      log("ERROR", "Axios Error Response", {
        error: err.response?.data || err.message,
        details: err,
      });
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
