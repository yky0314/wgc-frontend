import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, Slider, Switch, Typography, Divider, Button } from "antd";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  tickBgSimulation,
  createBgTaxi,
  mulberry32,
} from "../utils/backgroundSim";
import roadNetworkData from "../data/roadNetwork.json";

const { Text, Title } = Typography;

const DT_MS = 100;

function SliderBlock({ label, value, min, max, step, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <Text style={{ color: "#a3a3a3", fontSize: 13 }}>{label}</Text>
        <Text style={{ color: "#f5f5f5", fontSize: 13 }}>{value}</Text>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        tooltip={{ formatter: null }}
      />
    </div>
  );
}

export default function AnalyticsDashboard({
  isOnline,
  currentLat,
  currentLon,
  onBgDataUpdate,
}) {
  const [showParams, setShowParams] = useState(false);

  // 模拟参数
  const [numTaxis, setNumTaxis] = useState(200);
  const [spawnRate, setSpawnRate] = useState(8);
  const [speed, setSpeed] = useState(15);
  const [maxMatchDist, setMaxMatchDist] = useState(150);
  const [matchedStay, setMatchedStay] = useState(50);
  const [passengerTTL, setPassengerTTL] = useState(120);

  const [showBgTaxis, setShowBgTaxis] = useState(true);
  const [showBgPassengers, setShowBgPassengers] = useState(true);

  // 内部状态
  const rngRef = useRef(mulberry32(45));
  const simStateRef = useRef({
    taxis: [],
    passengers: [],
    nextPassengerId: 0,
  });
  const [probHistory, setProbHistory] = useState([
    { time: 0, avgProb: 0, paxProb: 0 },
  ]);
  const tickRef = useRef(0);
  const intervalRef = useRef(null);

  // 初始化/重置
  const resetSimulation = (taxiCount) => {
    const rng = mulberry32(Math.floor(Math.random() * 1000));
    rngRef.current = rng;
    simStateRef.current = {
      taxis: Array.from({ length: taxiCount }, (_, i) =>
        createBgTaxi(`bg_t_${i}`, rng, roadNetworkData)
      ),
      passengers: [],
      nextPassengerId: 0,
    };
    tickRef.current = 0;
    setProbHistory([{ time: 0, avgProb: 0, paxProb: 0 }]);
    onBgDataUpdate({ taxis: [], passengers: [] });
  };

  // 当数量变化或位置变化时重置
  useEffect(() => {
    if (isOnline) {
      resetSimulation(numTaxis);
    } else {
      onBgDataUpdate({ taxis: [], passengers: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numTaxis, currentLat, currentLon, isOnline]);

  // 运行循环
  useEffect(() => {
    if (!isOnline) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      const nextState = tickBgSimulation({
        taxis: simStateRef.current.taxis,
        passengers: simStateRef.current.passengers,
        nextPassengerId: simStateRef.current.nextPassengerId,
        rng: rngRef.current,
        spawnRate,
        speedMps: speed,
        maxMatchDistM: maxMatchDist,
        matchedStayTicks: matchedStay,
        passengerTTLTicks: passengerTTL,
        dtMs: DT_MS,
        roadNetwork: roadNetworkData,
      });

      simStateRef.current = {
        taxis: nextState.taxis,
        passengers: nextState.passengers,
        nextPassengerId: nextState.nextPassengerId,
      };

      tickRef.current += 1;

      // 更新图表 (每5 tick更新一次以节约性能)
      if (tickRef.current % 5 === 0) {
        setProbHistory((prev) => {
          const newHist = [
            ...prev,
            {
              time: tickRef.current,
              avgProb: Number(nextState.avgProb.toFixed(4)),
              paxProb: Number(nextState.paxProb.toFixed(4)),
            },
          ];
          return newHist.length > 50
            ? newHist.slice(newHist.length - 50)
            : newHist;
        });
      }

      // 上传给 App 渲染
      onBgDataUpdate({
        taxis: showBgTaxis ? nextState.taxis : [],
        passengers: showBgPassengers ? nextState.passengers : [],
      });
    }, DT_MS);

    return () => clearInterval(intervalRef.current);
  }, [
    isOnline,
    currentLat,
    currentLon,
    spawnRate,
    speed,
    maxMatchDist,
    matchedStay,
    passengerTTL,
    showBgTaxis,
    showBgPassengers,
    onBgDataUpdate,
  ]);

  const latestAvg =
    probHistory.length > 0 ? probHistory[probHistory.length - 1].avgProb : 0;
  const latestPax =
    probHistory.length > 0 ? probHistory[probHistory.length - 1].paxProb : 0;

  if (!isOnline) return null;

  return (
    <Card
      size="small"
      style={{
        position: "absolute",
        top: 20,
        left: 20,
        width: 380,
        backgroundColor: "rgba(18, 18, 18, 0.85)",
        backdropFilter: "blur(10px)",
        border: "1px solid #333",
        zIndex: 1000,
        color: "#fff",
      }}
      bodyStyle={{ padding: "16px 20px" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Title level={5} style={{ color: "#fff", margin: 0 }}>
          Live Network Analytics
        </Title>
        <Button size="small" ghost onClick={() => setShowParams(!showParams)}>
          {showParams ? "Hide Params" : "Show Params"}
        </Button>
      </div>

      <div style={{ height: 160, width: "100%", marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={probHistory}
            margin={{ top: 5, right: 5, bottom: 5, left: -25 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
            <XAxis dataKey="time" stroke="#a3a3a3" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 1]} stroke="#a3a3a3" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f1f1f",
                border: "none",
                color: "#fff",
              }}
              itemStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 5 }} />
            <Line
              type="monotone"
              dataKey="avgProb"
              name="Driver Utilization"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="paxProb"
              name="Passenger Match Rate"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
        }}
      >
        <Text style={{ color: "#fbbf24" }}>
          Driver: {(latestAvg * 100).toFixed(1)}%
        </Text>
        <Text style={{ color: "#60a5fa" }}>
          Pax: {(latestPax * 100).toFixed(1)}%
        </Text>
      </div>

      {showParams && (
        <>
          <Divider style={{ borderColor: "#444", margin: "16px 0" }} />
          <div style={{ maxHeight: 250, overflowY: "auto", paddingRight: 8 }}>
            <SliderBlock
              label="Fleet Size (Drivers)"
              value={numTaxis}
              min={20}
              max={800}
              step={20}
              onChange={setNumTaxis}
            />
            <SliderBlock
              label="Passenger Spawn Rate"
              value={spawnRate}
              min={1}
              max={30}
              step={1}
              onChange={setSpawnRate}
            />
            <SliderBlock
              label="Movement Speed"
              value={speed}
              min={5}
              max={40}
              step={1}
              onChange={setSpeed}
            />
            <SliderBlock
              label="Match Radius (m)"
              value={maxMatchDist}
              min={50}
              max={1000}
              step={50}
              onChange={setMaxMatchDist}
            />

            <Divider style={{ borderColor: "#444", margin: "16px 0" }} />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "#a3a3a3", fontSize: 13 }}>
                Show Background Drivers
              </Text>
              <Switch
                checked={showBgTaxis}
                onChange={setShowBgTaxis}
                size="small"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Text style={{ color: "#a3a3a3", fontSize: 13 }}>
                Show Background Passengers
              </Text>
              <Switch
                checked={showBgPassengers}
                onChange={setShowBgPassengers}
                size="small"
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
