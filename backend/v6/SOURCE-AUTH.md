# v4 来源授权与Endpoint部署前清单

## v4 Endpoint约束（本轮唯一业务补修）

服务端启动时必须由可信部署配置设置 `INGEST_PUBLIC_ENDPOINT`，没有全环境默认地址；不读Host、X-Forwarded-Host、客户端body中的endpoint来决定授权服务。配置缺失/无效时可信认证及需要授权的prepared恢复失败关闭，HTTP返回503 `E_SOURCE_ENDPOINT_CONFIG`（权限库未配置仍按原E_AUTH_NOT_CONFIGURED政策）。旧无来源请求按原规则归档，不因此得到训练权限；有未完成可信prepared且配置缺失时，恢复需管理员先修复配置。

URL规则：绝对ASCII URL（国际域名需先配置经核对的ASCII punycode）；HTTPS为正式协议。scheme和DNS主机名转小写、标准IPv4/IPv6规范化，HTTPS默认443/HTTP默认80省略，空路径变`/`。路径大小写、非根尾斜杠和百分转义的字面拼写保留区别，不折叠成同一授权服务。百分转义须合法UTF-8；拒绝用户信息、query/fragment（含空分隔符）、空/无效host、非法端口、空白/控制字符、反斜杠、点遍历及解码后的危险路径。不做DNS解析或时间/IP身份推断。

本地测试HTTP需同时显式设置 `INGEST_ALLOW_LOOPBACK_HTTP=1`，且host必须是localhost或标准loopback IP；LAN/公网HTTP即使开关打开也拒绝。管理员CLI签发/轮换本地HTTP凭证需在子命令前加 `--allow-loopback-http`，默认仍只接受HTTPS。此开关仅供隔离测试，不是生产HTTPS替代方案。

SourceAuthority.authorize读取credentials.endpoint，与服务端预期URL规范化后比较；不匹配403 `E_SOURCE_ENDPOINT_MISMATCH`，不产生AuthorizedSource或可信接收效果，响应不含秘密/具体数据库字段。prepared_guard读取同一字段、应用同一比较规则，不匹配返回False，原文和prepared保留；同主体合法轮换后可在正确服务显式重新授权原冻结批次。撤销、过期及原有namespace规则不变。

issue先校验并规范化Endpoint，rotate保持原合法Endpoint约束。现有合法v3记录读取时规范化比较，无需为了大小写、默认端口或根斜杠重新签发/改写旧记录；无效旧字符串不会被当作合法接收服务。只有管理员CLI签发，未增加HTTP注册或共享密钥。

v4部署前除下列v3清单外，必须核对公开HTTPS接收URL、代理外部路径与配置一致，并实测A/B共享权限库时相互拒绝。Endpoint配置必须按进程重启加载；不要把请求头或用户输入写入部署配置。原持久化、训练资格、Manifest及修订合并实现未改。

---

以下为继续适用的v3基础协议；其中可信认证还需满足上面的Endpoint约束。

本包是离线审查源码，不是部署包。没有HTTP注册、账号认领或共享客户端密钥。管理员拥有来源发放权，必须在独立受控渠道核实申请者；当前代码不能证明玩家实名、设备硬件或外部训练过程。

## 协议

- GET `/`：ingest-capabilities-v1，版本[2,3]、source/receipt schema、认证方案operator-bearer-v1、realm、旧归档允许、未认证训练禁止。能力查询不验证具体凭证。
- POST `/` 或 `/ingest`：保留正式客户端的根路径。其他POST返回404 E_UPLOAD_ROUTE；无注册路径。
- v2/裸数组且无来源/Authorization：可靠原始归档，sourceTrust=archive-only、eligibleSource=false。
- v3：source含schema/domain/instanceId（客户端持久ID）/principalId/realmId；Authorization为管理员独立签发的Bearer。字段必须全部与服务端凭证记录绑定。body中不能带token。
- 训练命名空间来自服务端realm+domain+principal，不来自自报instanceId、IP、UA或时间。同实例字符串的不同独立凭证具有不同principal；只有管理员显式rotate保留principal。
- 每次POST包括重放都先校验凭证，再进入当前请求的原文准备/索引；认证失败无成功回执，不新增该请求训练索引。qualifiedSamples=null仍表示未知，认证不等于样本合格。

## 受控签发（仅供受授权管理员，未在生产执行）

使用新的私有数据库路径，不要指向inbox.sqlite或旧dedup.sqlite。保护父目录、DB、WAL、输出JSON的OS ACL。Windows不提供本代码层面的静态加密或硬件绑定；TLS由可信代理终止。

```powershell
python server/source_auth.py --db <NEW_PRIVATE_AUTH_DB> init
python server/source_auth.py --db <AUTH_DB> issue --client-instance <CLIENT_INSTANCE_ID> --endpoint https://data.feiqiaoai.uno/ --output <NEW_PRIVATE_CREDENTIAL_JSON>
python server/source_auth.py --db <AUTH_DB> rotate --credential-id <OLD_CREDENTIAL_ID> --output <NEW_PRIVATE_CREDENTIAL_JSON>
python server/source_auth.py --db <AUTH_DB> revoke --credential-id <CREDENTIAL_ID>
```

输出文件不覆盖；数据库只存随机秘密的SHA-256，凭证默认30天。CLI不打印token；经受控渠道交付给对应客户端。rotate仅是管理员授权动作，没有匿名续签或网络认领。同主体多个有效凭证须分别管理/吊销，丢失的key应明确吊销，不要假定客户端删除就等于服务端吊销。

客户端安装本轮Commit后，通过 `window.__DJSC.cloudFeedback.sourceStatus()` 获取instanceId。用可信本地文件读取后调用 `configureSourceCredential(privateObject)`，不要把JSON贴进公开日志、截图、聊天或普通配置key；方法返回值只有脱敏状态。凭证存在独立djsc_ingest_source_credential_v1，不参与上传快照或pending。status不会把本地安装当作已认证。

凭证丢失且身份还在：管理员核实所有权后轮换原凭证，客户端重试原pending。身份存储损坏不自动覆盖。新设备/实例重置默认新身份和新principal，不能继承旧事务；若需要继续旧pending，应在明确授权下恢复完整原身份备份与有效凭证，或另行审查迁移方案。本轮没有自动rebind/转移归属接口。复制身份与凭证相当于复制持有权限，必须用吊销处理失窃。

## 接收状态与恢复

授权证明在原prepared事务内写入request_authorizations。原文仍完整不可变；请求哈希增加服务端主体作用域，轮换同主体保持幂等，不同主体即使body完全相同也不复用他人的回执。旧v2索引/原文均不删除；没有授权侧表的旧记录不因source字段或离线source映射获得信任。

活跃接收的授权检查与吊销通过授权库BEGIN IMMEDIATE串行：已经取得授权的在途接收先完成，吊销成功提交后的新请求/重放被拒绝。进程中断的prepared恢复重新核对凭证：已吊销/过期者原文保留、仍prepared、没有可信训练效果；新合法同主体凭证可对冻结原包重新授权续传。没有授权配置时该可信恢复失败关闭，不能悄悄转为可信。

## 配置与限制

服务仅在显式INGEST_BASE_DIR写入，默认127.0.0.1:8787。需要管理员准备INGEST_AUTH_DB指向已初始化权限库；缺失时可信接收关闭，旧无来源请求仍可归档（已有可信prepared需要管理员恢复权限配置）。INGEST_TRUSTED_PROXIES默认空，只有显式可信CIDR代理的单个合法CF-Connecting-IP或X-Forwarded-For才被采纳；代理须覆盖/剔除用户伪造头，多值/非法地址拒绝。直连一律socket地址。

所有上传尝试（含认证失败、重放）按12/IP/小时；旧误名blacklist不再授予999999次豁免。429返回Retry-After并CORS暴露。能力GET不消耗上传额度，无凭证签发HTTP入口。当前限流是每进程内存，重启/多副本共享额度未实现；生产只按单进程/单入口部署约束验收，集中配额需另行实现。认证DB、inbox DB应在可靠本地文件系统，预留原文双份/WAL空间、备份与监控，不使用未经验证的网络文件系统。

客户端有凭证时GET能力/realm严格校验，HTTPS（测试仅允许loopback HTTP）、禁止重定向，协商等待后再次绑定同一凭证，再POST；旧服务器不支持时不发送凭证/样本并保留pending。永久401/403/协议拒绝暂停，更新凭证或显式retrySourceAuthorization后再试；网络/503/429维持原退避。旧pending不追加来源、不改样本ID、不强制重传历史。无凭证仅执行旧归档协议，不能保证旧未修服务器的训练策略安全。

## 复现

```powershell
$env:CLIENT_ROOT='<本轮客户端源码>'
$env:BACKEND_V2_ROOT='<已核验v2源码解压目录>'
python -m unittest discover -s tests -v
```

真实宿主输入位于客户端tools/fixtures/source-auth-host-lineage.json，仅包含隔离无名杀1.11.7真实事件生成的三阶段样本；没有制造收益或终局。test_client_network使用实际上传代码与本机随机端口。原B算法测试通过明确的受控凭证夹具继续保持原持久化/幂等/冲突/Manifest断言；不把测试夹具当生产注册。未知来源、v2旧库保留和吊销后的prepared均有单独拒绝测试。

未验收：生产TLS与可信代理实际配置、实际玩家凭证发放、手机WebView、生产多副本配额、真实磁盘满/断电、实体对局跨热重载身份、真实历史数据迁移及正式训练器；不声称这些已完成。
