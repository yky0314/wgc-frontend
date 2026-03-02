import React from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Tag,
  Input,
  Switch,
  Select,
  Space,
  Divider,
  Typography,
} from "antd";
import { calculateDistance } from "../utils/geoUtils";

const { Text } = Typography;

function ControlPanel({
  driverId,
  isOnline,
  currentLat,
  currentLon,
  passengers,
  selectedPassenger,
  isSimulating,
  showRivalDrivers,
  onToggleOnline,
  onStartSimulation,
  onStopSimulation,
  onResetSimulation,
  onRequestPassengers,
  onToggleRivalDrivers,
  onCenterMap,
}) {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (value) => {
    i18n.changeLanguage(value);
    localStorage.setItem("locale", value);
  };

  const getPassengerDistance = () => {
    if (!selectedPassenger) return null;
    return calculateDistance(
      currentLat,
      currentLon,
      selectedPassenger.lat,
      selectedPassenger.lng
    );
  };

  return (
    <div className="control-panel">
      {/* 标题和状态 */}
      <div className="panel-header">
        <span className="panel-title">{t("title")}</span>
        <Tag color={isOnline ? "success" : "default"}>
          {isOnline ? t("online") : t("offline")}
        </Tag>
      </div>

      {/* 司机ID */}
      <div className="info-section">
        <div className="info-label">{t("driverId")}</div>
        <Input value={driverId} disabled />
      </div>

      {/* 当前位置 */}
      <div className="info-section">
        <div className="info-label">{t("currentLocation")}</div>
        <div className="info-value">
          {currentLat.toFixed(4)}, {currentLon.toFixed(4)}
        </div>
      </div>

      {/* 乘客信息 */}
      <div className="info-section">
        <div className="info-label">{t("passengers")}</div>
        <div className="info-value">
          {passengers.length > 0 ? (
            <>
              {passengers.length} {t("passengers")}
              {selectedPassenger && (
                <>
                  <Divider type="vertical" />
                  {t("distance")}: {getPassengerDistance()} m
                </>
              )}
            </>
          ) : (
            <Text type="secondary">无乘客</Text>
          )}
        </div>
      </div>

      {/* 语言切换 */}
      <div className="info-section">
        <div className="info-label">{t("language")}</div>
        <Select
          value={i18n.language}
          onChange={handleLanguageChange}
          style={{ width: "100%" }}
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />
      </div>

      <Divider />

      {/* 操作按钮 */}
      <div className="button-group">
        <Button
          type={isOnline ? "default" : "primary"}
          danger={isOnline}
          block
          onClick={onToggleOnline}
        >
          {isOnline ? t("goOffline") : t("goOnline")}
        </Button>

        <Space.Compact style={{ width: "100%" }}>
          <Button
            type="primary"
            disabled={!isOnline || passengers.length === 0}
            onClick={onStartSimulation}
            style={{ flex: 1 }}
          >
            ▶️ {t("start")}
          </Button>
          <Button
            disabled={!isSimulating}
            onClick={onStopSimulation}
            style={{ flex: 1 }}
          >
            ⏸️ {t("stop")}
          </Button>
        </Space.Compact>

        <div className="button-row">
          <Button onClick={onResetSimulation} style={{ flex: 1 }}>
            🔄 {t("reset")}
          </Button>
          <Button type="primary" onClick={onCenterMap} style={{ flex: 1 }}>
            📍 {t("center")}
          </Button>
        </div>

        <Button
          type="dashed"
          block
          disabled={!isOnline}
          onClick={onRequestPassengers}
        >
          {t("addPassenger")}
        </Button>
      </div>

      <Divider />

      {/* 显示/隐藏竞争司机 */}
      <div className="switch-row">
        <span className="switch-label">{t("otherDriversVisible")}</span>
        <Switch
          checked={showRivalDrivers}
          onChange={onToggleRivalDrivers}
          checkedChildren={t("show")}
          unCheckedChildren={t("hide")}
        />
      </div>
    </div>
  );
}

export default ControlPanel;
