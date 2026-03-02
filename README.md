# 司机模拟器 (Driver Simulator)

基于 React + deck.gl + Mapbox 的实时司机模拟系统，支持司机-乘客匹配算法。

## 技术栈

- **前端框架**: React 18
- **地图可视化**: deck.gl + Mapbox GL
- **UI 组件**: Ant Design
- **HTTP 客户端**: Axios
- **国际化**: react-i18next
- **构建工具**: Vite

## 功能特性

### 核心功能

1. **司机模拟**

   - 司机上线/下线状态管理
   - 实时位置更新（每 600ms）
   - 基于 OSRM 的路网驱动
   - 行驶轨迹可视化

2. **乘客管理**

   - 从后端获取 5 个附近乘客
   - 显示乘客位置和距离
   - 点击乘客选择目标

3. **竞争司机**

   - 显示 3 个竞争司机
   - 基于 OSRM 的路网随机移动
   - 可切换显示/隐藏

4. **智能匹配算法**

   - 每 10 秒自动触发匹配
   - 仅匹配 3km 内的乘客
   - 匹配成功后颜色变化（绿色）
   - 显示匹配连线

5. **地图可视化**

   - 使用 Mapbox 底图（新加坡）
   - deck.gl 图层渲染
   - 司机：黄色 🚕（未匹配）/ 绿色 ✅（已匹配）
   - 乘客：蓝色 🎯（未匹配）/ 绿色 ✅（已匹配）
   - 竞争司机：红色 🚗

6. **国际化**
   - 支持中文/英文切换
   - 语言偏好持久化

## 环境配置

### 环境变量 (.env.development)

```
VITE_API_BASE=https://postconsonantal-tyrell-untactual.ngrok-free.dev
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

### API 接口

所有接口使用 `/api/v1/` 前缀（通过 nginx 转发）

1. **请求乘客** - `POST /api/v1/drivers/requestPassenger`

   ```json
   {
     "driverId": 10001,
     "latitude": 1.3521,
     "longitude": 103.8198
   }
   ```

2. **请求竞争司机** - `POST /api/v1/drivers/requestRivalDrivers`

   ```json
   {
     "driverId": 10001,
     "latitude": 1.3521,
     "longitude": 103.8198
   }
   ```

3. **匹配算法** - `POST /api/match/match`

   ```json
   {
     "drivers": {
       "d_10001": [1.3521, 103.8198],
       "d_1": [1.3292, 103.7009],
       "d_2": [1.3377, 103.6988],
       "d_3": [1.352, 103.7]
     },
     "passengers": {
       "p_1": [1.3408, 103.6972],
       "p_2": [1.3441, 103.6845],
       "p_3": [1.3431, 103.6925],
       "p_4": [1.3509, 103.6999],
       "p_5": [1.3462, 103.6846]
     },
     "k": 10,
     "max_dist": 0.05
   }
   ```

4. **更新位置** - `POST /api/v1/drivers/location/update`

   ```json
   {
     "driverId": 10001,
     "latitude": 1.3521,
     "longitude": 103.8198
   }
   ```

5. **更新状态** - `POST /api/v1/drivers/update`
   ```json
   {
     "driverId": 10001,
     "currentStatus": "IDLE",
     "onboardedAt": "2024-01-01T00:00:00.000Z",
     "createdAt": "2019-08-24T14:15:22.123Z",
     "updatedAt": "2024-01-01T00:00:00.000Z"
   }
   ```

## 安装和运行

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 使用说明

1. **上线司机**

   - 点击"上线"按钮
   - 系统自动请求附近乘客和竞争司机

2. **开始模拟**

   - 确保已上线且有乘客
   - 点击"开始"按钮
   - 司机将自动向选中的乘客移动
   - 每 10 秒自动触发匹配算法

3. **查看匹配结果**

   - 匹配成功的司机和乘客变为绿色
   - 显示匹配连线

4. **控制面板功能**
   - 停止：暂停模拟
   - 重置：回到初始位置
   - 居中：地图居中到司机位置
   - 添加乘客：重新请求乘客
   - 显示/隐藏竞争司机

## 配置参数

在 `src/App.jsx` 中可以调整以下参数：

```javascript
const SIM_INTERVAL_MS = 600; // 模拟更新间隔（毫秒）
const SIM_SPEED_MPS = 6; // 移动速度（米/秒）
const ARRIVAL_THRESHOLD_M = 8; // 到达阈值（米）
const MATCH_TRIGGER_DISTANCE = 3000; // 匹配触发距离（米）
const MATCH_INTERVAL = 10000; // 匹配间隔（毫秒）
```

## 项目结构

```
src/
├── components/
│   └── ControlPanel.jsx       # 控制面板组件
├── services/
│   ├── api.js                 # Axios 配置
│   └── drivers.js             # 司机 API
├── utils/
│   └── geoUtils.js            # 地理计算工具
├── i18n/
│   └── config.js              # 国际化配置
├── App.jsx                    # 主应用组件
├── App.css                    # 应用样式
├── main.jsx                   # 入口文件
└── index.css                  # 全局样式
```

## 注意事项

1. 需要有效的 Mapbox Token
2. 后端服务需要正常运行
3. OSRM 路由服务使用公共端点，可能有速率限制
4. 所有坐标基于 WGS84 坐标系
5. 乘客和司机坐标由后端保证在道路节点上

## 开发者

- 使用 React Hooks 进行状态管理
- deck.gl 提供高性能地图渲染
- Ant Design 提供现代化 UI 组件
- 支持中英文双语界面
