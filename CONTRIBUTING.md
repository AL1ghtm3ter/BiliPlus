# 为 BiliPlus 贡献

先阅读 README、FEATURES 和 ARCHITECTURE。修改功能时检查初始化、设置变更、路由切换和关闭清理，保留原生节点及事件行为。

开发使用 Node.js 24。提交前运行 `npm ci`、`npm run check`、`npm run format:check`、`npm test`、`npm run build`。真实功能另在 Chrome 加载 `extension` 并刷新 B站页面验证；记录环境与证据，不能把模拟检查写成真实网站验收。

标题、评论和配置均按数据处理，禁止据此执行代码或请求任意地址。修改异步功能要检查关闭后晚返回的响应，页面路由及节点替换也需覆盖。

只提交独立源码、合成测试和必要文档。不要提交开发依赖、浏览器配置、账号凭据、绝对用户目录、私人历史材料、第三方插件包或签名媒体地址。发布包由白名单生成。图标源与生成方式见 LOGO.md。

贡献的独立源码及资产按 MIT 提供；保留第三方署名和许可，见 THIRD-PARTY-NOTICES.md。
