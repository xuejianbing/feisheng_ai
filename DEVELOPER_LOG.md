# 无名AI 开发者日志

## v4.1.0 - 开源首个版本（2026-10-14）

### 架构概览

```
├── extension.js          # 扩展主入口
├── info.json             # 扩展元信息
├── js/                   # 基础配置与工具
│   ├── bootstrap/        # 启动引导
│   ├── config/           # 配置定义（版本号唯一权威源）
│   ├── content/          # 内容处理
│   └── shared/           # 共享工具
├── score/                # 决策积分引擎核心
│   ├── index.js          # 模块入口
│   ├── perception/       # 感知层
│   ├── cognition/         # 认知层
│   ├── decision/         # 决策层
│   ├── model/            # 模型层
│   ├── verification/     # 验证层
│   ├── view/             # UI视图层
│   ├── foundation/        # 基础框架
│   ├── knowledge/        # 知识库
│   ├── plugins/          # 插件系统
│   └── _ARCHITECTURE.md  # 架构文档
├── shadow/               # 影子决策对比
│   ├── shadowCore.js     # 影子核心
│   └── decodeV5.js        # V5决策解码
├── model/                # 模型权重文件
│   ├── v5_mixup_s42.json # 种子42模型
│   └── v5_mixup_s456.json # 种子456模型
├── logs/                 # 日志系统
└── tests/                # 测试用例
```

### 开发规范

1. **版本号管理**
   - 版本号唯一权威源：`js/config/version.js`
   - `info.json` 的 version 必须与 `VERSION` 常量保持一致
   - 修改版本号时同步更新 CHANGELOG.md 和 DEVELOPER_LOG.md

2. **新增模块要求**
   - 所有新增功能必须接入自检系统（selfCheck.js）
   - 提供 `stats()` 和 `health()` 接口，返回 {ok, status, data}
   - 推理头扩展（__AI_REASON）每加新功能必须同步加 `__AI_REASON.cmd.<功能名>()` 命令

3. **参数设计原则**
   - 优先使用软指标（softMetrics），不要硬编码死值
   - 让模型自己学习调整权重，而不是写死阈值

4. **代码修改约束**
   - 无名杀本体（noname）只读参考，绝不修改
   - 一切修改只在无名AI扩展内做
   - 修改文件结构或import路径后，必须在真实运行环境验证跳转成功

### 当前已知问题

- [ ] shadow模式reward计算不完整，只记录我方消耗，未正确计算敌方收益
- [ ] isEnemy判定缺失导致reward全为负值
- [ ] 集成模型与单种子差异较小，需要更多样本验证集成效果

### 贡献指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交修改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 提交 Pull Request

### 联系方式

- 原作者：飞升
- 当前维护：WeiqiaoCode（微雀qiao）
- QQ交流群：1080487560
