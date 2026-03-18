const fs = require("fs");
const http = require("http");

// 覆盖新加坡全岛主要市镇和商圈的高密度锚点
const points = [
  { name: "Changi Airport", lat: 1.3644, lon: 103.9915 },
  { name: "Tampines", lat: 1.3521, lon: 103.9448 },
  { name: "Pasir Ris", lat: 1.3721, lon: 103.9474 },
  { name: "Bedok", lat: 1.3236, lon: 103.9273 },
  { name: "Paya Lebar", lat: 1.3174, lon: 103.8925 },
  { name: "Marine Parade", lat: 1.302, lon: 103.9051 },
  { name: "Punggol", lat: 1.4045, lon: 103.9021 },
  { name: "Sengkang", lat: 1.3917, lon: 103.8944 },
  { name: "Hougang", lat: 1.3728, lon: 103.8937 },
  { name: "Serangoon", lat: 1.3508, lon: 103.8732 },
  { name: "Ang Mo Kio", lat: 1.3703, lon: 103.8497 },
  { name: "Bishan", lat: 1.3505, lon: 103.8486 },
  { name: "Toa Payoh", lat: 1.3343, lon: 103.8501 },
  { name: "Novena", lat: 1.3201, lon: 103.8434 },
  { name: "Orchard", lat: 1.3005, lon: 103.8443 },
  { name: "CBD", lat: 1.2847, lon: 103.8522 },
  { name: "Bugis", lat: 1.3006, lon: 103.8559 },
  { name: "Chinatown", lat: 1.2843, lon: 103.8436 },
  { name: "Yishun", lat: 1.4304, lon: 103.8354 },
  { name: "Sembawang", lat: 1.4491, lon: 103.8185 },
  { name: "Woodlands", lat: 1.4382, lon: 103.789 },
  { name: "Bukit Panjang", lat: 1.3764, lon: 103.7677 },
  { name: "Choa Chu Kang", lat: 1.3854, lon: 103.7443 },
  { name: "Bukit Batok", lat: 1.3496, lon: 103.7513 },
  { name: "Jurong East", lat: 1.3329, lon: 103.7436 },
  { name: "Jurong West", lat: 1.3385, lon: 103.7058 },
  { name: "Boon Lay", lat: 1.3384, lon: 103.7061 },
  { name: "Clementi", lat: 1.3162, lon: 103.7649 },
  { name: "Buona Vista", lat: 1.306, lon: 103.7906 },
  { name: "Queenstown", lat: 1.2942, lon: 103.8062 },
  { name: "Bukit Merah", lat: 1.2801, lon: 103.8252 },
  { name: "Sentosa", lat: 1.2494, lon: 103.8303 },
];

// 高密度蛛网连线：让相邻/相近的区域互相连接
const pairs = [
  // 东部
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 6],
  [3, 4],
  [3, 5],
  [4, 5],
  [4, 16],
  // 东北部
  [6, 7],
  [7, 8],
  [8, 9],
  [7, 18],
  [9, 10],
  [9, 4],
  // 中部/北部
  [18, 19],
  [19, 20],
  [10, 11],
  [11, 12],
  [12, 13],
  [13, 14],
  [10, 18],
  // 核心区
  [14, 15],
  [14, 16],
  [15, 17],
  [16, 15],
  [17, 30],
  [15, 31],
  // 西北部/西部
  [20, 21],
  [21, 22],
  [22, 23],
  [23, 24],
  [24, 25],
  [25, 26],
  [24, 27],
  // 西南部
  [27, 28],
  [28, 29],
  [29, 30],
  [28, 14],
  [30, 31],
  [27, 23],
  // 一些跨区主干道（增加长途路线）
  [0, 16], // ECP
  [1, 10], // TPE/CTE
  [10, 21], // BKE
  [20, 24], // KJE/PIE
  [3, 27], // PIE (东到西)
  [4, 13], // PIE (中段)
  [12, 28], // Lornie/Queensway
  [7, 15], // KPE
  [18, 14], // CTE
  [22, 14], // BKE/PIE
  // 增加毛细血管短途
  [1, 3],
  [8, 11],
  [11, 13],
  [14, 17],
  [29, 15],
  [23, 28],
  [5, 15],
  [2, 7],
  [9, 12],
  [13, 16],
  [17, 15],
  [30, 15],
  [24, 28],
];

const routes = [];
let completed = 0;

function generateFallbackRoute(p1, p2) {
  const pts = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    pts.push({
      lat: p1.lat + (p2.lat - p1.lat) * (i / steps),
      lon: p1.lon + (p2.lon - p1.lon) * (i / steps),
    });
  }
  return pts;
}

function fetchRoute(p1, p2) {
  const url = `http://router.project-osrm.org/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}?overview=full&geometries=geojson`;
  http
    .get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.routes && json.routes.length > 0) {
            const coords = json.routes[0].geometry.coordinates.map((c) => ({
              lat: c[1],
              lon: c[0],
            }));
            routes.push(coords);
            console.log(
              `Fetched route: ${p1.name} -> ${p2.name} (${coords.length} points)`
            );
          } else {
            routes.push(generateFallbackRoute(p1, p2));
          }
        } catch (e) {
          console.log(`Failed to parse route: ${p1.name} -> ${p2.name}`);
          routes.push(generateFallbackRoute(p1, p2));
        }
        checkDone();
      });
    })
    .on("error", (e) => {
      console.log(
        `Error fetching route: ${p1.name} -> ${p2.name} - ${e.message}`
      );
      routes.push(generateFallbackRoute(p1, p2));
      checkDone();
    });
}

function fetchRouteAsync(p1, p2) {
  return new Promise((resolve) => {
    const url = `http://router.project-osrm.org/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}?overview=full&geometries=geojson`;
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.routes && json.routes.length > 0) {
              const coords = json.routes[0].geometry.coordinates.map((c) => ({
                lat: c[1],
                lon: c[0],
              }));
              routes.push(coords);
              console.log(
                `Fetched route: ${p1.name} -> ${p2.name} (${coords.length} points)`
              );
            } else {
              routes.push(generateFallbackRoute(p1, p2));
            }
          } catch (e) {
            console.log(`Failed to parse route: ${p1.name} -> ${p2.name}`);
            routes.push(generateFallbackRoute(p1, p2));
          }
          resolve();
        });
      })
      .on("error", (e) => {
        console.log(
          `Error fetching route: ${p1.name} -> ${p2.name} - ${e.message}`
        );
        routes.push(generateFallbackRoute(p1, p2));
        resolve();
      });
  });
}

async function run() {
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    await fetchRouteAsync(points[pair[0]], points[pair[1]]);
    // 延迟 500ms 防止被封
    await new Promise((res) => setTimeout(res, 500));
  }
  if (!fs.existsSync("src/data")) {
    fs.mkdirSync("src/data", { recursive: true });
  }
  fs.writeFileSync("src/data/roadNetwork.json", JSON.stringify(routes));
  console.log(
    "Successfully wrote roadNetwork.json with " + routes.length + " routes."
  );
}

run();
