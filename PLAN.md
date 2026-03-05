# PLAN.md：璀璨宝石对决 Web 远程联机版实施方案

## 摘要
- 目标是交付一个可直接远程对战的 Web H5 版本，采用“好友房 + 实时回合制 + 服务器权威裁判”。
- 首版范围包含：游客登录、建房/加房、完整规则执行、回合计时、断线重连、战绩查询。
- 首版不做：排位系统、观战、回放分享、商业化、跨平台原生 App。

## 成功标准（验收口径）
1. 两名玩家可通过房间码在不同网络环境下完成一整局对战。
2. 所有规则由服务端裁判，客户端无法提交非法动作并改变对局。
3. 断线后 180 秒内重连可恢复同一局状态；超时按判负处理。
4. 对局结束后可查询完整战绩摘要与关键回合日志。
5. 同区域网络下，95 分位动作回执延迟小于 300ms。

## 范围定义
1. In Scope：Web H5、2 人实时对战、好友房、规则引擎、计时器、重连、基础战绩页、日志与告警。
2. Out of Scope：匹配排位、观战、录像回放、AI 对手、语音聊天、支付系统、社交裂变功能。

## 技术架构与仓库结构
1. 技术栈固定为全栈 TypeScript。
2. 前端：Next.js 15 + React 19 + Zustand + Tailwind CSS。
3. 后端：NestJS 11 + Socket.IO + Prisma + PostgreSQL 16 + Redis 7。
4. 架构原则：服务端权威状态机；客户端仅发“意图动作”。
5. 仓库结构采用 monorepo：
- `apps/web`：H5 客户端
- `apps/server`：HTTP + WS 服务
- `packages/engine`：纯函数规则引擎
- `packages/shared`：卡牌数据、协议类型、常量

## 重要公共接口与类型变更
1. 新增 REST API：
- `POST /api/v1/auth/guest`：创建游客身份并返回 JWT
- `POST /api/v1/rooms`：创建好友房并返回 `roomCode`
- `POST /api/v1/rooms/{roomCode}/join`：加入房间
- `GET /api/v1/matches/{matchId}`：获取对局详情与当前快照
- `GET /api/v1/me/history?cursor=`：分页获取个人战绩
2. 新增 WebSocket 命名空间 `/ws/game`：
- 客户端事件：`room.subscribe`、`room.ready`、`match.action`、`match.resign`、`match.sync`
- 服务端事件：`room.state`、`match.snapshot`、`match.event`、`match.error`、`match.finished`
3. 新增共享类型（`packages/shared`）：
- `GameSnapshot`
- `PlayerAction`
- `ActionResult`
- `MatchSummary`
- `ProtocolError`
4. `PlayerAction` 固定枚举：
- `USE_PRIVILEGE`
- `REFILL_BOARD`
- `TAKE_TOKENS_LINE`
- `RESERVE_WITH_GOLD`
- `BUY_CARD`
- `RESIGN`
5. 每个动作必须带 `clientActionId` 和 `expectedActionSeq`，用于幂等与乱序保护。

## 规则引擎与状态机设计
1. 引擎 API 固定：
- `createInitialState(seed, players): GameSnapshot`
- `validateAction(state, action, playerId): ValidationResult`
- `applyAction(state, action, playerId): { nextState, events }`
2. 状态机阶段固定：
- `OPTIONAL_PRIVILEGE`
- `OPTIONAL_REFILL`
- `FORCED_ACTION`
- `RESOLVE_EFFECTS`
- `END_TURN_CHECK`
- `FINISHED`
3. 随机性统一由服务端种子驱动，抽牌/补盘全过程可重放。
4. 必须覆盖规则要点：
- 可选行动顺序与可跳过
- 强制行动三选一与“无法执行时先补盘”特例
- 直线拿筹码合法性判定
- 黄金仅可通过“预留并拿黄金”获取
- 10 筹码手牌上限回合末校验
- 5 类能力即时结算
- 第 3/6 王冠触发王室卡
- 三种胜利条件回合末判定

## 数据模型（PostgreSQL）
1. `users`：游客账号与基础资料。
2. `rooms`：房间码、状态、创建者、过期时间。
3. `room_players`：房间成员、就绪状态、座位顺序。
4. `matches`：对局元数据、当前快照 JSON、结果、开始/结束时间。
5. `match_events`：按 `action_seq` 追加记录动作与系统事件。
6. `player_stats`：总局数、胜率、平均时长、最近对局时间。
7. Redis 用途：在线会话、房间 Presence、回合计时器、临时重连映射。

## 前端实现方案（Web H5）
1. 页面：
- `/` 主页（创建房间/输入房间码）
- `/room/[code]` 房间准备页
- `/match/[id]` 对局页
- `/history` 战绩页
2. 对局页模块：
- 棋盘与筹码区
- 卡牌金字塔与预留区
- 双方资源区（筹码/奖励/王冠/声望）
- 回合计时与行动面板
- 断线与重连状态条
3. 交互策略：
- 客户端不本地结算，仅显示服务端回包状态
- 提交动作后禁用重复提交，待 `actionSeq+1` 回包再解锁
- 接收 `match.snapshot` 时强制对齐本地状态

## 后端联机与容错策略
1. 房间生命周期：创建 -> 等待第二人 -> 双方就绪 -> 开局 -> 结算 -> 房间关闭。
2. 断线重连：连接断开后保留席位 180 秒；重连后推送最新 `match.snapshot`。
3. 计时规则：每回合 120 秒；超时立即判负并结束对局。
4. 幂等与顺序：重复 `clientActionId` 直接返回历史结果；`expectedActionSeq` 不符则拒绝并下发新快照。
5. 服务重启恢复：从 `matches.current_snapshot` + `match_events` 重建内存房间状态。

## 安全与风控
1. JWT 鉴权用于 REST 与 WS 握手。
2. 速率限制：房间相关 10 req/min，动作相关 30 req/min/连接。
3. 输入校验：所有动作参数使用 Zod/DTO 双层校验。
4. 反作弊核心：规则验证仅在服务端执行；客户端仅作渲染。
5. 审计日志：记录非法动作、频繁断线、异常超时行为。

## 测试用例与场景
1. 单元测试（`packages/engine`）：
- 开局补盘与随机流程可复现
- 可选/强制阶段切换
- 3 种强制行动合法与非法路径
- 5 类能力结算正确性
- 王冠、王室卡与胜利条件判定
2. 集成测试（`apps/server`）：
- 建房到完赛全链路
- 非法动作拒绝与错误码
- 断线后重连恢复
- 重复动作幂等
- 超时判负
3. E2E（Playwright 双浏览器）：
- 两地网络模拟完成对局
- 移动端视口可玩性
- 弱网下状态最终一致
4. 非功能测试：
- 200 并发连接压测
- 1,000 连续动作无状态错乱
- 关键接口与 WS 错误率低于 0.5%

## 里程碑（4 周）
1. 第 1 周：搭建 monorepo、共享类型、卡牌配置、规则引擎骨架与核心单测。
2. 第 2 周：房间系统、WS 协议、动作处理链路、对局持久化。
3. 第 3 周：H5 对局 UI、回合交互、重连与错误态、战绩页。
4. 第 4 周：联调、压测、E2E、海外环境部署、监控告警与发布验收。

## 部署与运维（先海外云）
1. 区域：新加坡单区域。
2. 运行方式：Docker 化部署 `web` 与 `server`；PostgreSQL/Redis 使用托管服务。
3. 域名与 HTTPS：Cloudflare 代理与证书管理。
4. 监控：Sentry（前后端异常）、Prometheus 指标、Grafana 仪表盘。
5. 告警：动作失败率、WS 连接数骤降、接口高延迟阈值告警。

## 假设与默认项
1. 首版平台固定为 Web H5。
2. 对战节奏固定为实时回合制。
3. 产品范围固定为好友房 MVP。
4. 技术栈固定为全栈 TypeScript。
5. 首版先海外云上线，不做中国大陆合规上线流程。
6. 美术资源首版可用占位素材，后续再替换正式资源。
