async function run() {
  const { mulberry32, tickBgSimulation, createBgTaxi } = await import('../src/utils/backgroundSim.js');
  const fs = require('fs');
  const roadNetworkData = JSON.parse(fs.readFileSync('./src/data/roadNetwork.json'));

  const rng = mulberry32(42);
  const taxis = [createBgTaxi("t1", rng, roadNetworkData)];
  console.log("Initial:", taxis[0].lat, taxis[0].lon, taxis[0].routeIdx, taxis[0].ptIdx);

  for(let i=0; i<10; i++) {
    const nextState = tickBgSimulation({
      taxis, passengers: [], nextPassengerId: 0, rng, spawnRate: 0,
      speedMps: 15, maxMatchDistM: 100, matchedStayTicks: 10, passengerTTLTicks: 10,
      dtMs: 100, roadNetwork: roadNetworkData
    });
    taxis[0] = nextState.taxis[0];
    console.log(`Tick ${i}: lat=${taxis[0].lat.toFixed(6)}, lon=${taxis[0].lon.toFixed(6)}, pt=${taxis[0].ptIdx}`);
  }
}
run();
