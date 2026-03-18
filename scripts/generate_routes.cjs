const fs = require("fs");
const http = require("http");

// 覆盖新加坡全岛主要市镇和商圈的高密度锚点 (32个)
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

// 构建密集的真实网格
const pairs = [
  // 东区互联
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 6],
  [3, 4],
  [3, 5],
  [4, 5],
  // 东北与中部互联
  [6, 7],
  [7, 8],
  [8, 9],
  [7, 18],
  [9, 10],
  [9, 4],
  [18, 19],
  [19, 20],
  [10, 11],
  [11, 12],
  [12, 13],
  [13, 14],
  [10, 18],
  // 核心区微循环
  [14, 15],
  [14, 16],
  [15, 17],
  [16, 15],
  [17, 30],
  [15, 31],
  // 西北部与西区
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
  // 超长干道骨架 (PIE, ECP, CTE, AYE等近似路线)
  [0, 16],
  [1, 10],
  [10, 21],
  [20, 24],
  [3, 27],
  [4, 13],
  [12, 28],
  [7, 15],
  [18, 14],
  [22, 14],
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
  // 为了路网更密，再补充一些跨节点
  [0, 5],
  [1, 8],
  [3, 15],
  [26, 27],
  [21, 12],
  [19, 22],
  [4, 14],
];

const routes = [];

function fetchRoute(p1, p2) {
  return new Promise((resolve, reject) => {
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
              resolve(coords);
            } else {
              reject(new Error("No route found"));
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (e) => reject(e));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`Will fetch ${pairs.length} routes in total. Please wait...`);

  for (let i = 0; i < pairs.length; i++) {
    const p1 = points[pairs[i][0]];
    const p2 = points[pairs[i][1]];

    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      try {
        const coords = await fetchRoute(p1, p2);
        routes.push(coords);
        console.log(
          `[${i + 1}/${pairs.length}] Fetched route: ${p1.name} -> ${
            p2.name
          } (${coords.length} points)`
        );
        success = true;
      } catch (err) {
        retries--;
        console.log(
          `[${i + 1}/${pairs.length}] Retry left ${retries} for ${p1.name} -> ${
            p2.name
          }: ${err.message}`
        );
        if (retries > 0) {
          await sleep(3000); // 被拒绝后等3秒再试
        }
      }
    }

    // 强制每次请求不管成功失败都延时，防限流
    await sleep(1500);
  }

  if (!fs.existsSync("src/data")) {
    fs.mkdirSync("src/data", { recursive: true });
  }

  if (routes.length > 0) {
    fs.writeFileSync("src/data/roadNetwork.json", JSON.stringify(routes));
    console.log(
      `\n🎉 Successfully wrote roadNetwork.json with ${routes.length} highly accurate routes.`
    );
  } else {
    console.log(
      `\n❌ Failed to fetch any routes. OSRM API might be fully blocked.`
    );
  }
}

run();
