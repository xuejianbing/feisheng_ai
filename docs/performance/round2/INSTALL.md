# 第二轮 QA 安装与回退
仅供源码复审；未更改正式4.4.3版本号。Android实机未验收。
1. 备份原游戏和用户存档，准备两个相同宿主的独立副本及独立浏览器配置。
2. A解压 baseline.zip，B解压 QA-round2.zip 到各自 extension/，确保 extension/无名AI/extension.js。不要同时安装两个同名扩展。
3. 使用相同测试配置、武将/手牌/座次及CPU条件。不要覆盖原用户模型、训练数据或数据库。
4. SHA256SUMS.txt 校验整包；*-files.json列出包内每个文件的SHA-256。delivery.json/FINAL-COMMIT.txt标明源码提交。
5. 回退时退出B并使用保留的A；不要把B存档覆盖到A。
review.patch为官方基线至本轮完整补丁；round2.patch为aa919bb至本轮补修。
