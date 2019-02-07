const fetch = require("isomorphic-fetch");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const inquirer = require("inquirer");

function getEnv(key, required = true) {
  const envVar = process.env[key];
  if (!envVar && required) {
    console.error(`${key} environment variable required.`);
    return process.exit(1);
  }
  return envVar;
}

const authHeaders = {
  "x-auth-email": getEnv("EMAIL"),
  "x-auth-key": getEnv("API_KEY")
};

const baseUrl = "https://api.cloudflare.com/client/v4";
const actions = {
  listZones: {
    method: "GET",
    url: "/zones?status=active&page=1&per_page=20&order=name"
  },
  createZoneFirewallRule: {
    method: "POST",
    url: "/zones/:zone_id/firewall/access_rules/rules"
  }
};

function escapeRegexp(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function act(action, { params, ...otherOptions } = {}) {
  const url = baseUrl + replaceParams(action.url, params || {});
  const method = action.method;

  const headers = { ...authHeaders, accept: "application/json" };

  if (["POST", "PUT"].indexOf(method) > -1) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    ...otherOptions,
    headers: {
      ...headers,
      ...(otherOptions.headers || {})
    }
  });
  return response.json();
}

function replaceParams(url, params) {
  return Object.keys(params).reduce((string, key) => {
    return string.replace(
      new RegExp(`\\:${escapeRegexp(key)}`, "g"),
      params[key]
    );
  }, url);
}

async function processLineByLine(filepath, cb) {
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    await cb(line);
  }
}

// main function
async function main() {
  const { zone, notes } = await inquirer.prompt([
    {
      name: "zone",
      type: "list",
      message: "Zone:",
      choices: async () => {
        const zones = await act(actions.listZones);
        return zones.result.map(z => ({
          value: z.id,
          name: z.name
        }));
      }
    },
    {
      name: "notes",
      type: "input",
      message: "Notes (optional):"
    }
  ]);

  const filename = path.resolve(__dirname, "./ip_addresses.txt");
  await processLineByLine(filename, async ip => {
    if (ip) {
      await act(actions.createZoneFirewallRule, {
        params: { zone_id: zone },
        body: JSON.stringify({
          mode: "whitelist",
          configuration: {
            target: "ip",
            value: ip
          },
          notes
        })
      });
      console.log(`Added ${ip} to zone ${zone}.`);
    }

    return;
  });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(69);
  });
