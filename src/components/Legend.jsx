import React from "react";
import "./Legend.css";

function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Map Legend</div>
      <div className="legend-items">
        {/* ── Main Driver ── */}
        <div className="legend-item">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="#1890ff"
              stroke="#fff"
              strokeWidth="2"
            />
            <path
              d="M16 8 L20 14 L12 14 Z M14 16 L18 16 L18 22 L14 22 Z"
              fill="#fff"
            />
          </svg>
          <span>Main Driver (Idle)</span>
        </div>
        <div className="legend-item">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="#52c41a"
              stroke="#fff"
              strokeWidth="2"
            />
            <path
              d="M16 8 L20 14 L12 14 Z M14 16 L18 16 L18 22 L14 22 Z"
              fill="#fff"
            />
          </svg>
          <span>Driver (Going to Pickup)</span>
        </div>
        <div className="legend-item">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="#722ed1"
              stroke="#fff"
              strokeWidth="2"
            />
            <path
              d="M16 8 L20 14 L12 14 Z M14 16 L18 16 L18 22 L14 22 Z"
              fill="#fff"
            />
          </svg>
          <span>Driver (Carrying Passenger)</span>
        </div>

        {/* ── Rival Driver ── */}
        <div className="legend-item">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="#ff4d4f"
              stroke="#fff"
              strokeWidth="2"
            />
            <path
              d="M16 8 L20 14 L12 14 Z M14 16 L18 16 L18 22 L14 22 Z"
              fill="#fff"
            />
          </svg>
          <span>Rival Driver (Idle)</span>
        </div>

        {/* ── Passenger ── */}
        <div className="legend-item">
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle
              cx="14"
              cy="14"
              r="12"
              fill="#fa8c16"
              stroke="#fff"
              strokeWidth="2"
            />
            <circle cx="14" cy="10" r="4" fill="#fff" />
            <path d="M8 22 Q8 16 14 16 Q20 16 20 22" fill="#fff" />
          </svg>
          <span>Passenger (Waiting)</span>
        </div>

        {/* ── Lines ── */}
        <div className="legend-item">
          <svg width="40" height="4" viewBox="0 0 40 4">
            <line
              x1="0"
              y1="2"
              x2="40"
              y2="2"
              stroke="#52c41a"
              strokeWidth="3"
            />
          </svg>
          <span>Match Line</span>
        </div>
        <div className="legend-item">
          <svg width="40" height="4" viewBox="0 0 40 4">
            <line
              x1="0"
              y1="2"
              x2="40"
              y2="2"
              stroke="#409eff"
              strokeWidth="3"
            />
          </svg>
          <span>Driver Path</span>
        </div>
      </div>
    </div>
  );
}

export default Legend;
