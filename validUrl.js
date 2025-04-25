import dotenv from "dotenv";
import fs from "fs";
dotenv.config({ path: "./Config.env" });

function getServiceUrl(serviceName) {
  const configPath = process.env.CONFIG_PATH;

  if (!configPath) {
    throw new Error("CONFIG_PATH environment variable is not defined.");
  }

  const configFile = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(configFile);

  return config[serviceName] || null;
}

export default getServiceUrl;
