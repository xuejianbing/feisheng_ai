# 4.4.3 本地源码复审 QA 安装与 A/B

此包没有更改正式版本号；用文件名、delivery.json 中的提交和 SHA-256 区分。2V2 性能验收未通过，不是正式发布候选。

1. 先保留原安装目录和用户存档的完整备份。不要在唯一的游戏安装上直接覆盖测试。
2. 分别准备两个相同版本的独立无名杀宿主副本，扩展目录均为 extension/无名AI。不要改扩展目录名，也不要同时安装两个同名扩展。若浏览器 Web 版，使用两个独立用户配置目录；不要删除或共用原用户配置。
3. A 副本解压 baseline ZIP，B 副本解压 QA-review-only ZIP，使 extension/无名AI/extension.js 路径正确。ZIP 已含顶层 无名AI 文件夹，避免多套一层目录。
4. 用相同的配置、公开测试局面与测试专用存档（另取副本）进行对照。保持手机型号、WebView/Chrome版本、温度、电量、后台负载、限速设置和运行次数一致。首次安装、已有模型、关闭/开启 shadow 分开测试，每类分别标记冷/热缓存。
5. PowerShell 校验：Get-FileHash -Algorithm SHA256 -LiteralPath './wumingAI-4.4.3-QA-review-only.zip'，与 SHA256SUMS.txt 对比。baseline-files.json / QA-review-only-files.json 是实际 ZIP 内每个文件的尺寸与 SHA-256。
6. 控制台执行 JSON.stringify(window.__DJSC.perfReport(), null, 2) 获取轨迹；window.__DJSC.panelLoadStatus 查看各入口状态。panelsReady 仅表示 lazy 入口注册完成，首次面板代码可能尚未加载。
7. v5 读取失败后保持失败状态以避免循环重试；off/on 不会重试，需要刷新页面。原默认开关、训练和模型资格门槛未调整。
8. 测试结束退出 B 副本即可回退；不要删除、覆盖或导入原用户的模型与训练存档。不要直接将 QA 存档覆盖回 A。

完整复审报告位于源码 docs/performance/MOBILE-PERFORMANCE-REVIEW-443.md。补丁位于 review.patch 与 commits/。没有 push、merge 或发布操作。
